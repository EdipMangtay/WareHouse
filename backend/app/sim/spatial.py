"""Layout-derived directed navigation. No scheduler or multi-agent optimizer lives here."""
from __future__ import annotations

from collections import deque
import hashlib
import math
from typing import Any
from .astar import NavGrid, is_walkable, can_traverse, to_cell, cell_center

CARDINAL = ((1, 0), (-1, 0), (0, 1), (0, -1))
DIRECTIONS = {"+x": (1, 0), "-x": (-1, 0), "+z": (0, 1), "-z": (0, -1)}


def apply_corridors(layout: dict[str, Any], grid: NavGrid, floor: int) -> NavGrid:
    """Masks constrain both entry and exit; perpendicular crossings stay permitted."""
    grid.cell_size = float(layout['grid']['cell_size'])
    corridors = layout.get('navigation', {}).get('corridors', [])
    rules: dict[tuple[int, int], set[tuple[int, int]]] = {}
    ids = set()
    for corridor in corridors:
        if corridor['id'] in ids:
            raise ValueError('Duplicate corridor ID')
        ids.add(corridor['id'])
        if corridor.get('floor', 1) not in {f['id'] for f in layout['floors']}:
            raise ValueError('Corridor references an unknown floor')
        mode = corridor.get('mode', 'two_way')
        if mode not in ('one_way', 'two_way'):
            raise ValueError('Corridor mode must be one_way or two_way')
        x0, z0, x1, z1 = corridor['rect']
        if not all(math.isfinite(v) for v in (x0,z0,x1,z1)) or not (0 <= x0 < x1 <= layout['size']['width'] and 0 <= z0 < z1 <= layout['size']['depth']):
            raise ValueError('Corridor rectangle is outside the warehouse')
        if mode == 'one_way' and corridor.get('direction') not in DIRECTIONS:
            raise ValueError('One-way corridor requires +x, -x, +z or -z direction')
        if corridor.get('floor',1) != floor or mode == 'two_way':
            continue
        direction = DIRECTIONS[corridor['direction']]
        for r in range(grid.rows):
            for c in range(grid.cols):
                x,z = cell_center((c,r),grid.cell_size)
                if x0 <= x < x1 and z0 <= z < z1 and is_walkable(grid,c,r):
                    allowed = rules.setdefault((c,r), set())
                    if (-direction[0],-direction[1]) in allowed:
                        raise ValueError('Conflicting one-way corridors overlap')
                    allowed.add(direction)
    outgoing = bytearray(len(grid.cells))
    for r in range(grid.rows):
        for c in range(grid.cols):
            if not is_walkable(grid,c,r): continue
            for bit,(dx,dz) in enumerate(CARDINAL):
                other=(c+dx,r+dz)
                if not is_walkable(grid,*other): continue
                constraints=rules.get((c,r),set()) | rules.get(other,set())
                if any(dx*vx+dz*vz < 0 for vx,vz in constraints): continue
                outgoing[r*grid.cols+c] |= 1 << bit
    grid.outgoing=outgoing
    return grid


def operational_nodes(layout: dict[str,Any], grids: dict[int,NavGrid]) -> list[dict]:
    result=[]
    def add(id,kind,floor,point,zone=None):
        grid=grids.get(floor)
        cell=to_cell(*point,layout['grid']['cell_size'])
        result.append(dict(id=id,kind=kind,floor=floor,zone=zone,cell=list(cell),world=list(point),valid=bool(grid and is_walkable(grid,*cell))))
    for loc in layout['locations']:
        add(loc['id'],loc['kind'],loc.get('floor',1),loc['access_point'],loc.get('zone'))
    for s in layout['stations']:
        if not any(n['id']==s['id'] for n in result): add(s['id'],s['kind'],s.get('floor',1),s['access_point'],s.get('zone'))
    for c in layout['charging_stations']:
        if not any(n['id']==c['id'] for n in result): add(c['id'],'CHARGING',c.get('floor',1),c['access_point'],c.get('zone'))
    for r in layout['spawn']['robots']:
        add('SPAWN:'+r['id'],'SPAWN',r.get('floor',1),[r['position'][0],r['position'][2]])
    return result


def reachable(grid:NavGrid, start:tuple[int,int], reverse=False) -> set[tuple[int,int]]:
    if not is_walkable(grid,*start): return set()
    seen={start};queue=deque([start])
    while queue:
        a=queue.popleft()
        for dx,dz in CARDINAL:
            b=(a[0]+dx,a[1]+dz)
            if b not in seen and (can_traverse(grid,b,a) if reverse else can_traverse(grid,a,b)):
                seen.add(b);queue.append(b)
    return seen


def validate_navigation(layout:dict, grids:dict[int,NavGrid]) -> dict:
    nodes=operational_nodes(layout,grids);errors=[];floors={};unreachable=[];isolated=[]
    invalid=[n['id'] for n in nodes if not n['valid']]
    ids=set();spawn_cells=set()
    for node in nodes:
        if node['id'] in ids: errors.append(f"Duplicate operational node: {node['id']}")
        ids.add(node['id'])
        if node['kind']=='SPAWN':
            key=(node['floor'],*node['cell'])
            if key in spawn_cells:
                invalid.append(node['id']);errors.append('Overlapping robot spawn cells')
            spawn_cells.add(key)
    indexed={n['id']:n for n in nodes}
    for obj in [*layout['stations'],*layout['charging_stations']]:
        node=indexed[obj['id']]
        if node['world']!=list(obj['access_point']) or node['floor']!=obj.get('floor',1):
            errors.append(f"Inconsistent station access point: {obj['id']}")
    for floor,grid in grids.items():
        candidates=[n for n in nodes if n['floor']==floor and n['valid']]
        anchor=next((n for n in candidates if n['kind']=='SPAWN'),candidates[0] if candidates else None)
        free={(i%grid.cols,i//grid.cols) for i,v in enumerate(grid.cells) if v!=1 and is_walkable(grid,i%grid.cols,i//grid.cols)}
        forward=reachable(grid,tuple(anchor['cell'])) if anchor else set()
        reverse=reachable(grid,tuple(anchor['cell']),True) if anchor else set()
        bad=[n['id'] for n in candidates if tuple(n['cell']) not in forward or tuple(n['cell']) not in reverse]
        unreachable.extend(bad)
        for zone in layout['zones']:
            if zone.get('floor',1)!=floor: continue
            xs=[p[0] for p in zone['polygon']];zs=[p[1] for p in zone['polygon']]
            if not any(min(xs)<=cell_center(c,grid.cell_size)[0]<max(xs) and min(zs)<=cell_center(c,grid.cell_size)[1]<max(zs) for c in forward & reverse):
                isolated.append(zone['id'])
        floors[str(floor)]=dict(anchor=anchor['id'] if anchor else None,walkable_cells=len(free),forward_reachable=len(forward),return_reachable=len(reverse),strongly_connected=free==forward==reverse)
        if free and (free != forward or free != reverse): errors.append(f'Floor {floor}: disconnected or directionally isolated cells')
    if invalid: errors.append('Invalid access/spawn nodes')
    if unreachable: errors.append('Unreachable operational nodes')
    if isolated: errors.append('Isolated operational zones')
    return dict(valid=not errors,errors=errors,floors=floors,invalid_nodes=invalid,unreachable_nodes=unreachable,isolated_zones=isolated)


def compile_navigation(layout:dict) -> dict:
    from .navgrid import build_nav_grid
    config=layout['grid'];cs=config['cell_size']
    if not math.isfinite(cs) or cs<=0 or any(type(config[k]) is not int or config[k]<=0 for k in ('cols','rows')):
        raise ValueError('Invalid navigation grid dimensions')
    if not math.isclose(config['cols']*cs,layout['size']['width']) or not math.isclose(config['rows']*cs,layout['size']['depth']):
        raise ValueError('Visual warehouse and navigation dimensions disagree')
    nav=layout.get('navigation',{})
    if any(not math.isfinite(nav.get(k,0)) or nav.get(k,0)<0 for k in ('robot_radius','safety_margin','clearance_padding')) or int(nav.get('clearance_padding',0))!=nav.get('clearance_padding',0):
        raise ValueError('Invalid robot clearance configuration')
    if any(r.get('rotation',0)!=0 for r in layout['racks']):
        raise ValueError('Navigation currently requires axis-aligned racks (rotation=0)')
    if len({f['id'] for f in layout['floors']})!=len(layout['floors']):
        raise ValueError('Duplicate floor ID')
    raw={k:v for k,v in layout.items() if k!='navigation_graph'}
    grids={f['id']:build_nav_grid(raw,f['id']) for f in layout['floors']}
    floors={}
    for floor,g in grids.items():
        junctions=[]
        for r in range(g.rows):
            for c in range(g.cols):
                # Branch nodes in the cell graph. Open aprons legitimately have many.
                degree=sum(can_traverse(g,(c,r),(c+dx,r+dz)) for dx,dz in CARDINAL) if is_walkable(g,c,r) else 0
                if degree>=3: junctions.append([c,r])
        floors[str(floor)]=dict(cols=g.cols,rows=g.rows,cells=list(g.cells),outgoing=list(g.outgoing),junctions=junctions,
                               sha256=hashlib.sha256(bytes(g.cells)+bytes(g.outgoing)).hexdigest())
    return dict(version=1,cell_size=layout['grid']['cell_size'],directions=[list(d) for d in CARDINAL],
                floors=floors,nodes=operational_nodes(layout,grids),validation=validate_navigation(layout,grids))
