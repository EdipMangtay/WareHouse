"""Phase 3: shared spatial graph, hard constraints, access and live movement contracts."""
import copy
import hashlib
import json
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from app.layout_generator import generate_layout
from app.navigation_api import create_navigation_router
from app.routing import search
from app.sim.astar import NavGrid, astar, can_traverse, cell_center, to_cell
from app.sim.engine import SimEngine
from app.sim.navgrid import build_nav_grid, load_layout
from app.sim.spatial import apply_corridors, compile_navigation, validate_navigation

ROOT=Path(__file__).resolve().parents[3]

@pytest.mark.parametrize('preset',['small','medium','large','mega'])
def test_all_operational_nodes_and_zones_are_bidirectionally_reachable(preset):
    layout=load_layout(ROOT/f'shared/layouts/{preset}.json');graph=layout['navigation_graph']
    report=graph['validation']
    assert report['valid'],report
    assert report['invalid_nodes']==report['unreachable_nodes']==report['isolated_zones']==[]
    assert {'SHELF','INBOUND','OUTBOUND','PACKING','CHARGING','SPAWN'} <= {n['kind'] for n in graph['nodes']}
    assert sum(n['kind']=='SPAWN' for n in graph['nodes'])==len(layout['spawn']['robots'])
    for floor,data in graph['floors'].items():
        grid=build_nav_grid(layout,int(floor))
        assert hashlib.sha256(bytes(grid.cells)+bytes(grid.outgoing)).hexdigest()==data['sha256']
        assert report['floors'][floor]['walkable_cells']==report['floors'][floor]['return_reachable']
        assert data['junctions']


def lane(mode='one_way'):
    layout=dict(grid=dict(cols=5,rows=3,cell_size=1),size=dict(width=5,depth=3),floors=[dict(id=1)],navigation=dict(corridors=[dict(id='lane',rect=[0,0,5,3],mode=mode,direction='+x')]))
    return layout,apply_corridors(layout,NavGrid(5,3,bytearray(15)),1)


def test_one_way_applies_to_entry_exit_diagonals_but_allows_crossings():
    _,g=lane()
    assert can_traverse(g,(1,1),(2,1))
    assert not can_traverse(g,(2,1),(1,1))
    assert not can_traverse(g,(2,1),(1,2))
    assert can_traverse(g,(1,1),(1,2))
    assert astar(g,(4,1),(0,1)) is None
    assert astar(g,(0,1),(4,1))==[(1,1),(2,1),(3,1),(4,1)]
    _,g=lane('two_way')
    assert astar(g,(4,1),(0,1)) is not None


@pytest.mark.parametrize('algorithm',['astar','dijkstra','bellman_ford'])
def test_every_route_algorithm_respects_direction_cells_and_edges(algorithm):
    _,g=lane()
    assert search(g,(4,1),(0,1),algorithm)['status']=='unreachable'
    assert search(g,(0,1),(4,1),algorithm)['status']=='found'
    g.hard_blocked.add((4,1))
    assert search(g,(0,1),(4,1),algorithm)['status']=='unreachable'
    g.hard_blocked.clear();g.blocked_edges={((1,r),(2,r)) for r in range(3)}
    assert search(g,(0,1),(4,1),algorithm)['status']=='unreachable'


def test_dynamic_edge_never_bypassed_diagonally_and_reverse_is_independent():
    _,g=lane('two_way');g.blocked_edges.add(((1,1),(2,1)))
    assert not can_traverse(g,(1,1),(2,1))
    assert not can_traverse(g,(1,1),(2,2))
    assert can_traverse(g,(2,1),(1,1))
    path=astar(g,(1,1),(3,1));assert path
    for a,b in zip([(1,1),*path],path):assert can_traverse(g,a,b)
    g.hard_blocked.add((3,1));assert astar(g,(1,1),(3,1)) is None
    assert astar(g,(-1,1),(2,1)) is None


def test_invalid_corridor_configuration_fails_loudly():
    layout,_=lane();layout['navigation']['corridors'][0]['direction']='wrong'
    with pytest.raises(ValueError,match='direction'): apply_corridors(layout,NavGrid(5,3,bytearray(15)),1)
    layout,_=lane();other=copy.deepcopy(layout['navigation']['corridors'][0]);other.update(id='opposing',direction='-x');layout['navigation']['corridors'].append(other)
    with pytest.raises(ValueError,match='Conflicting'):apply_corridors(layout,NavGrid(5,3,bytearray(15)),1)


def test_diagnostics_find_invalid_spawns_pickups_and_isolated_zones():
    layout=generate_layout('small');grid=build_nav_grid(layout)
    layout['spawn']['robots'][0]['position']=[0,0,0]
    pickup=layout['locations'][0];grid.hard_blocked.add(to_cell(*pickup['access_point']))
    report=validate_navigation(layout,{1:grid})
    assert not report['valid'] and 'SPAWN:R01' in report['invalid_nodes'] and pickup['id'] in report['invalid_nodes']
    # A full-height closure isolates a whole half of the warehouse.
    grid.hard_blocked={(40,z) for z in range(grid.rows)}
    report=validate_navigation(layout,{1:grid})
    assert report['unreachable_nodes'] and report['isolated_zones']
    assert not report['floors']['1']['strongly_connected']


def test_clearance_and_dimension_validation():
    layout=generate_layout('small');base=build_nav_grid(layout)
    layout['navigation']['safety_margin']=.8
    wide=build_nav_grid(layout)
    assert sum(v==1 for v in wide.cells)>sum(v==1 for v in base.cells)
    layout['grid']['cols']+=1
    with pytest.raises(ValueError,match='dimensions'):compile_navigation(layout)


def test_world_cell_roundtrip_including_boundary_and_other_resolution():
    assert to_cell(-.01,1,1)==(-1,1)
    assert to_cell(1,2,1)==(1,2)
    for cs in [.25,1,2.5]:
        for cell in [(0,0),(17,29),(-3,5)]:assert to_cell(*cell_center(cell,cs),cs)==cell


def isolated_engine():
    layout=generate_layout('small');layout['spawn']['robots']=layout['spawn']['robots'][:1]
    engine=SimEngine(layout);engine.next_task_tick=10**12
    r=engine.state['robots']['R01'];r['home_zone']='SERVICE';r['position']=[38.5,0,13.5]
    engine._sync_navigation();engine._rebuild_occupancy()
    return engine,r,engine.rt['R01']


def test_path_in_flight_waits_at_closure_and_resumes_after_reopening():
    engine,r,rt=isolated_engine();goal=(41,13)
    engine._plan_to(r,rt,cell_center(goal),'TO_SOURCE')
    assert r['path']
    cells=[(40,z) for z in range(engine.grid.rows) if engine.grid.cells[z*engine.grid.cols+40]!=1]
    engine.change_navigation(1,cells,[],True)
    for _ in range(80):
        engine._rebuild_occupancy();engine._move_along_path(r,rt)
        assert to_cell(r['position'][0],r['position'][2])[0]<40
    assert rt.target==goal # An unreachable route must not report arrival.
    engine.change_navigation(1,cells,[],False)
    for _ in range(400):
        engine._rebuild_occupancy();engine._move_along_path(r,rt)
        if rt.target is None:break
    assert rt.target is None and to_cell(r['position'][0],r['position'][2])==goal


def test_plan_failure_retains_goal_and_clone_does_not_share_mutable_closures():
    engine,r,rt=isolated_engine()
    cells=[(40,z) for z in range(engine.grid.rows) if engine.grid.cells[z*engine.grid.cols+40]!=1]
    engine.change_navigation(1,cells,[],True)
    engine._plan_to(r,rt,(41.5,13.5),'TO_SOURCE')
    assert not r['path'] and rt.target==(41,13)
    clone=engine.clone();clone.change_navigation(1,cells,[],False)
    assert engine.grid.hard_blocked and not clone.grid.hard_blocked
    assert clone.grid is clone.grids[1] and engine.grid is engine.grids[1]


def test_zone_closure_survives_replan_fallback():
    engine,r,rt=isolated_engine();engine.blocked_zones.add('ZONE_A');engine._sync_navigation()
    goal=next(l for l in engine.layout['locations'] if l['kind']=='SHELF' and l['zone']=='ZONE_A')['access_point']
    assert astar(engine.grid,to_cell(r['position'][0],r['position'][2]),to_cell(*goal)) is None


def test_navigation_api_roundtrip_atomic_validation_and_limits():
    engine,r,_=isolated_engine();layout=engine.layout;layout['revision']='test';layout['navigation_graph']=compile_navigation(layout)
    called=[];app=FastAPI();app.include_router(create_navigation_router(lambda:SimpleNamespace(engine=engine,layout=layout),lambda request,bucket:called.append(bucket)))
    with TestClient(app) as client:
        assert client.get('/api/navigation/validate').json()['valid']
        assert client.get('/api/navigation?floor=99').status_code==404
        payload=dict(floor=1,action='block',cells=[[40,13]],edges=[[[39,13],[40,13]]],bidirectional=False)
        assert client.post('/api/navigation/disruptions',json=payload).status_code==200
        snap=client.get('/api/navigation').json();assert [40,13] in snap['manual_cells'];assert snap['blocked_edges']==[[[39,13],[40,13]]]
        before=set(engine.navigation_blocks[1])
        invalid=client.post('/api/navigation/disruptions',json=dict(action='block',cells=[[41,13],[0,0]]))
        assert invalid.status_code==422 and engine.navigation_blocks[1]==before
        assert client.post('/api/navigation/disruptions',json=dict(action='block',cells=[[38,13]])).status_code==422
        assert client.post('/api/navigation/disruptions',json=dict(action='block',cells=[[True,13]])).status_code==422
        assert client.post('/api/navigation/disruptions',json=dict(action='block',cells=[[40,13]]*257)).status_code==422
        assert client.post('/api/navigation/disruptions',json={**payload,'action':'unblock'}).status_code==200
        assert not engine.grid.hard_blocked and not engine.grid.blocked_edges
        assert called and set(called)=={'mutate'}


def test_python_typescript_directed_graph_fixture():
    fixture=json.loads((ROOT/'shared/navigation-fixture.json').read_text())
    raw=fixture['layout'];grid=build_nav_grid(raw)
    assert list(grid.cells)==fixture['cells'] and list(grid.outgoing)==fixture['outgoing']
    for c in fixture['blocked_cells']:grid.hard_blocked.add(tuple(c))
    for a,b in fixture['blocked_edges']:grid.blocked_edges.add((tuple(a),tuple(b)))
    for q in fixture['queries']:
        result=astar(grid,tuple(q['start']),tuple(q['goal']))
        assert (result is not None)==q['reachable']
        if result:
            for a,b in zip([tuple(q['start']),*result],result):assert can_traverse(grid,a,b)
