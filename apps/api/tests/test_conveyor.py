"""Physical movement, atomic ownership, deterministic merges and order consolidation."""
import copy
import math
import time
import uuid
from collections import Counter

import pytest
from app.layout_generator import generate_layout, validate_layout
from app.conveyor_layout import validate_network
from app.sim.engine import SimEngine
from app.schema import TwinState
from app.commerce import Commerce, Checkout


@pytest.fixture
def engine():
    e=SimEngine(generate_layout('small')); e.next_task_tick=10**12
    return e


def test_failed_queued_carrier_keeps_fifo_on_restore(engine):
    e=engine
    owner_task,owner,_=parcel(e)
    assert e.conveyor.claim_induction(e.state,owner_task,owner)
    task,_,p=parcel(e)
    robot=next(r for r in e.state['robots'].values() if r['home_zone']=='ZONE_A' and r['id']!=owner['id'])
    e.conveyor.picked(e.state,task,robot)
    robot['current_task_id']=task['id']
    assert not e.conveyor.claim_induction(e.state,task,robot)
    e._set_fsm(robot,'OFFLINE')
    e.clear_injection('ROBOT_FAILURE',robot['id'])
    assert e.rt[robot['id']].phase=='TO_INDUCTION_QUEUE'
    assert e.state['conveyor_system']['induction_owners']['IND-A']==owner['id']
    assert robot['payload_package_id']==p['package_id']


def test_controller_patch_omits_unchanged_static_routes():
    from app.main import TwinServer
    s=TwinServer(db_path=':memory:')
    s.engine.state['conveyor_system']['routing_table']={'entry>exit':['entry','exit']}
    assert 'routing_table' in s.make_patch()['conveyor_system']
    assert 'conveyor_system' not in s.make_patch()
    s.engine.state['conveyor_system']['metrics']['delivered']=1
    assert set(s.make_patch()['conveyor_system'])=={'metrics'}


def parcel(e, zone='ZONE_A', destination='PACK-01'):
    source=next(l['id'] for l in e.layout['locations'] if l['kind']=='SHELF' and l['zone']==zone)
    task=e.create_task('PICK','NORMAL',source,destination)
    robot=next(r for r in e.state['robots'].values() if r['home_zone']==zone)
    e.conveyor.picked(e.state,task,robot); robot['load']['current']=1
    return task,robot,e.state['packages'][task['package_id']]


def advance_belts(e,n=1):
    for _ in range(n):
        e.state['sim']['tick']+=1
        e.conveyor.step(e.state)


def invariants(e):
    packages=e.state['packages']; seen=set()
    for sid,segment in e.conveyor.segments.items():
        items=sorted((p for p in packages.values() if p['status']=='ON_CONVEYOR' and p['current_conveyor_segment']==sid),key=lambda p:p['conveyor_position'])
        assert len(items)<=segment['capacity']
        for p in items:
            assert p['package_id'] not in seen;seen.add(p['package_id'])
            assert p['robot_id'] is None
            assert 0<=p['conveyor_position']<=segment['length_m']+1e-8
        assert all(b['conveyor_position']-a['conveyor_position']>=segment['pitch_m']-1e-8 for a,b in zip(items,items[1:]))
    for r in e.state['robots'].values():
        if r.get('payload_package_id'):
            p=packages[r['payload_package_id']]
            assert p['robot_id']==r['id'] and p['status'] not in ('ON_CONVEYOR','DELIVERED')


def test_atomic_acceptance_and_capacity(engine):
    e=engine;task,r,p=parcel(e)
    assert e.conveyor.accept(e.state,task,r)
    assert r['load']['current']==0 and r['payload_package_id'] is None
    assert e.conveyor.accept(e.state,task,r)  # Retried confirmation is a no-op.
    assert len([h for h in p['timeline'] if h['status']=='ON_CONVEYOR'])==1
    task2,r2,p2=parcel(e)
    assert not e.conveyor.accept(e.state,task2,r2)
    assert r2['load']['current']==1 and p2['status']=='WAITING_INDUCTION'
    # The newly inducted carrier needs time to accelerate before freeing pitch.
    for _ in range(30):
        advance_belts(e)
        if p['conveyor_position'] >= e.conveyor.segments[p['route'][0]]['pitch_m']: break
    assert e.conveyor.accept(e.state,task2,r2)
    invariants(e)


@pytest.mark.parametrize('zone', ['ZONE_A','ZONE_B','ZONE_C','ZONE_D'])
def test_all_zones_all_destinations_follow_connected_paths(engine,zone):
    e=engine
    for destination in e.conveyor.network['unloading_points']:
        task,r,p=parcel(e,zone,destination)
        while not e.conveyor.accept(e.state,task,r): advance_belts(e)
        previous=e.conveyor.position(p)
        for _ in range(3000):
            advance_belts(e)
            if p['status']=='DELIVERED': break
            current=e.conveyor.position(p)
            assert math.dist(previous,current)<=.120001  # No station teleport, including corners.
            previous=current
        assert p['status']=='DELIVERED' and p['current_location']==destination
        scanned=[h['location'] for h in p['timeline'] if h['status']=='SCANNED']
        assert scanned==p['route'][1:]
        assert p['delivered_at']>p['loaded_at']
    TwinState.model_validate(e.state)


def test_full_network_backpressure_and_exit_recovery(engine):
    e=engine;exit=e.state['conveyor_system']['unloading_points']['PACK-01'];exit['enabled']=False
    pending=[]
    # More parcels than the route can physically hold; induction must retain payloads.
    for i in range(100):
        t,r,p=parcel(e,'ZONE_A' if i%2==0 else 'ZONE_C')
        # Controller fixture uses a distinct carrier for each queued parcel.
        carrier=copy.deepcopy(r);carrier['id']='CARRIER-'+str(i);carrier['payload_package_id']=p['package_id'];p['robot_id']=carrier['id']
        pending.append((t,carrier,p))
    for _ in range(1600):
        for t,r,p in pending:
            if p['status']!='ON_CONVEYOR': e.conveyor.accept(e.state,t,r)
        advance_belts(e)
        # Layout robots aren't the synthetic carriers in this controller-only test.
        for r in e.state['robots'].values(): r['payload_package_id']=None
        invariants(e)
    assert any(p['status']=='WAITING_INDUCTION' for _,_,p in pending)
    assert all(p['status']!='DELIVERED' for _,_,p in pending)
    count=e.state['conveyor_system']['metrics']['on_conveyor']
    advance_belts(e,100)
    assert e.state['conveyor_system']['metrics']['on_conveyor']==count
    exit['enabled']=True
    for _ in range(5000):
        for t,r,p in pending:
            if p['status']=='WAITING_INDUCTION': e.conveyor.accept(e.state,t,r)
        advance_belts(e)
        if all(p['status']=='DELIVERED' for _,_,p in pending): break
    assert all(p['status']=='DELIVERED' for _,_,p in pending)
    assert e.state['conveyor_system']['metrics']['delivered']==100
    invariants(e)


def test_exit_capacity_and_stopped_segment(engine):
    e=engine;exit=e.state['conveyor_system']['unloading_points']['PACK-01'];exit['capacity']=1
    # Customer parcels remain in consolidation until explicitly released.
    t,r,p=parcel(e);p['order_id']='CUSTOMER-1';assert e.conveyor.accept(e.state,t,r)
    advance_belts(e,20)
    t2,r2,p2=parcel(e);p2['order_id']='CUSTOMER-2';assert e.conveyor.accept(e.state,t2,r2)
    advance_belts(e,1000)
    assert p['status']=='DELIVERED' and p2['status']=='ON_CONVEYOR'
    before=p2['conveyor_position'];e.state['conveyors'][p2['current_conveyor_segment']]['status']='STOPPED'
    exit['items'].clear();advance_belts(e,100)
    assert p2['status']=='ON_CONVEYOR' and p2['conveyor_position']==before
    e.state['conveyors'][p2['current_conveyor_segment']]['status']='RUNNING';advance_belts(e,10)
    assert p2['status']=='DELIVERED'


@pytest.mark.parametrize('preset',['small','medium','large'])
def test_four_zone_order_real_robots_consolidation_dispatch(preset,tmp_path):
    e=SimEngine(generate_layout(preset));e.next_task_tick=10**12
    c=Commerce(str(tmp_path/f'{preset}.db'),e)
    order=c.checkout(Checkout(customer_name='Conveyor Test',email='test@example.com',address='Warehouse test address',
        items=[{'product_id':f'WT-00{i}','quantity':1} for i in range(1,5)],idempotency_key=uuid.uuid4().hex))
    states=set();partial=False;accepted=set()
    try:
        for tick in range(16000):
            e.step();c.advance()
            if tick%5==0:
                o=c.get_order(order['tracking_code']);states.add(o['status'])
                inbound=[p for p in e.state['packages'].values() if p['source_zone'].startswith('ZONE_')]
                arrived=sum(p['status']=='DELIVERED' for p in inbound)
                if 0<arrived<4:
                    partial=True;assert o['status']=='picking'
                for p in inbound:
                    if p['loaded_at'] is not None:accepted.add(p['package_id'])
                for r in e.state['robots'].values():
                    if r['home_zone'].startswith('ZONE_'):
                        x0,z0,x1,z1=e._zone_bounds[r['home_zone']]
                        assert x0<=r['position'][0]<=x1 and z0<=r['position'][2]<=z1
                invariants(e)
                if o['status']=='ready':break
        assert o['status']=='ready',(preset,o['status'],[(r['id'],r['fsm'],r['destination']) for r in e.state['robots'].values()])
        assert states=={'received','picking','packing','loading','ready'}
        assert partial and len(accepted)==4
        assert {p['source_zone'] for p in inbound}=={'ZONE_A','ZONE_B','ZONE_C','ZONE_D'}
        assert len({p['destination_station'] for p in inbound})==1
        assert len(e.state['packages'])==5
        assert all(p['status']=='DELIVERED' for p in e.state['packages'].values())
        TwinState.model_validate(e.state)
    finally:c.conn.close()


def test_invalid_topology_and_induction_are_rejected():
    l=generate_layout('small');l['conveyors'][0]['next']=['not-a-segment']
    with pytest.raises(ValueError,match='Disconnected'):validate_network(l)
    l=generate_layout('small');l['conveyors'][0]['next']=[]
    with pytest.raises(ValueError,match='destination'):validate_network(l)
    l=generate_layout('small');next(p for p in l['locations'] if p['id']=='IND-A')['access_point']=[4.5,18.5]
    with pytest.raises(ValueError,match='blocked'):validate_layout(l)


@pytest.mark.parametrize('preset',['small','medium','large','mega'])
def test_exterior_belts_form_a_complete_loop_without_entering_warehouse(preset):
    layout=generate_layout(preset)
    w,d=layout['size']['width'],layout['size']['depth']
    ring={s['id']:s for s in layout['conveyors'] if s['role']=='perimeter'}
    for s in layout['conveyors']:
        a,b=s['path']; half=s['width']/2
        assert (max(a[0],b[0])+half<=0 or min(a[0],b[0])-half>=w
                or max(a[1],b[1])+half<=0 or min(a[1],b[1])-half>=d),s['id']
    start=next(iter(ring)); current=start; visited=set()
    while current not in visited:
        visited.add(current)
        onward=[sid for sid in ring[current]['next'] if sid in ring]
        assert len(onward)==1
        current=onward[0]
    assert current==start and visited==set(ring)
    assert sum(s['length_m'] for s in ring.values())==2*(w+d)+32
    for p in layout['conveyor_network']['induction_points'].values():
        assert p['access_point'][0] in (2.5,w-2.5)


def test_exterior_belt_cannot_be_moved_back_inside():
    layout=generate_layout('small')
    layout['conveyors'][0]['path'][0][0]=5
    with pytest.raises(ValueError,match='enters warehouse'):
        validate_layout(layout)


def test_clone_determinism_and_no_shared_parcel_mutation(engine):
    t,r,p=parcel(engine);engine.conveyor.accept(engine.state,t,r)
    clone=engine.clone()
    advance_belts(engine,100);advance_belts(clone,100)
    assert engine.state==clone.state
    clone.state['packages'][p['package_id']]['conveyor_position']+=.1
    assert engine.state!=clone.state


@pytest.mark.parametrize('speed',[.6,1.2,2.4])
def test_induction_accelerates_and_belt_distance_uses_same_clock(engine,speed):
    e=engine;t,r,p=parcel(e)
    for conveyor in e.state['conveyors'].values():conveyor['speed_mps']=speed
    assert e.conveyor.accept(e.state,t,r)
    previous=0.
    for tick in range(1,41):
        advance_belts(e)
        assert p['velocity_mps'] <= speed+1e-8
        assert p['velocity_mps']-previous <= e.conveyor.acceleration*.1+1e-8
        previous=p['velocity_mps']
        assert e.state['conveyors'][p['route'][0]]['travelled_m']==pytest.approx(speed*tick*.1)
        invariants(e)
    sid=p['current_conveyor_segment'];before=p['conveyor_position'];belt=e.state['conveyors'][sid]['travelled_m']
    e.state['conveyors'][sid]['status']='STOPPED'
    advance_belts(e,10)
    assert p['conveyor_position']==before and p['velocity_mps']==0
    assert e.state['conveyors'][sid]['travelled_m']==belt
    e.state['conveyors'][sid]['status']='RUNNING'
    advance_belts(e)
    assert 0<p['velocity_mps']<=e.conveyor.acceleration*.1+1e-8


def test_handoff_wait_does_not_advance_drop_progress(engine):
    e=engine;t,r,p=parcel(e)
    r.update(fsm='DELIVERING',current_task_id=t['id'],operation_duration_ticks=30,operation_elapsed_ticks=0)
    rt=e.rt[r['id']];rt.dwell=30
    e.state['conveyors'][p['route'][0]]['status']='STOPPED'
    for _ in range(50):e._step_robot(r,rt)
    assert r['operation_elapsed_ticks']==0 and rt.dwell==30
    assert p['status']=='WAITING_INDUCTION'
    e.state['conveyors'][p['route'][0]]['status']='RUNNING'
    for i in range(29):
        e.state['sim']['tick']+=1;e._step_robot(r,rt)
        assert r['operation_elapsed_ticks']==i+1
        assert p['robot_id']==r['id']
    e.state['sim']['tick']+=1;e._step_robot(r,rt)
    assert p['status']=='ON_CONVEYOR' and p['robot_id'] is None
    assert r['operation_elapsed_ticks']==30
