import math
import pytest
from app.sim.engine import SimEngine
from app.sim.astar import NavGrid
from app.sim.navgrid import load_layout
from app.playback import PlaybackClock
from warehouse_core.legacy.motion import MotionConfig, route_eta


@pytest.mark.parametrize('speed', [.25, .5, 1, 2, 4])
@pytest.mark.parametrize('fps', [5, 15, 60, 144])
def test_wall_clock_fixed_steps_and_pause(speed, fps):
    clock = PlaybackClock(0)
    steps = 0
    for frame in range(1, fps*8+1):
        clock.accrue(speed, False, frame/fps)
        steps += clock.take_steps(.1)
    assert steps*.1 == pytest.approx(8*speed)
    clock.accrue(speed, True, 28)
    assert clock.take_steps(.1) == 0
    clock.accrue(.5, False, 30)
    assert clock.take_steps(.1) == 10


def test_delayed_server_loop_keeps_elapsed_time_without_unbounded_work_per_batch():
    clock = PlaybackClock(0)
    clock.accrue(4, False, 3)
    assert clock.take_steps(.1) == 40
    assert clock.take_steps(.1) == 40
    assert clock.take_steps(.1) == 40
    assert clock.take_steps(.1) == 0


@pytest.fixture
def route_robot():
    engine = SimEngine(load_layout())
    robot = next(iter(engine.state['robots'].values()))
    engine.state['robots'] = {robot['id']: robot}
    engine.grids = {1: NavGrid(50, 50, bytearray(2500))}
    engine.grid = engine.grids[1]
    robot.update(position=[2.5,0,2.5], heading=0., velocity=0., home_zone=None, floor=1)
    engine.occupancy.clear()
    return engine, robot, engine.rt[robot['id']]


@pytest.mark.parametrize('path', [
    [[x,2] for x in range(3,25)],
    [[x,2] for x in range(3,12)]+[[11,z] for z in range(3,12)],
])
def test_motion_acceleration_turn_stop_and_eta_agree(route_robot, path):
    engine, robot, rt = route_robot
    robot.update(path=path, path_index=0)
    rt.target=tuple(path[-1])
    estimate=route_eta(path,0,robot['position'],robot['heading'],0,robot['max_speed'],engine.motion)
    ticks=0; top_speed=0
    while rt.target is not None and ticks<4000:
        old=robot['position'][:]; velocity=robot['velocity']; heading=robot['heading']
        engine.state['sim']['tick']+=1
        engine._move_along_path(robot,rt)
        ticks+=1
        delta=math.dist(old,robot['position'])
        top_speed=max(top_speed,robot['velocity'])
        assert delta <= robot['max_speed']*.1+1e-8
        assert robot['velocity']-velocity <= engine.motion.acceleration_mps2*.1+1e-8
        assert velocity-robot['velocity'] <= engine.motion.deceleration_mps2*.1+1e-8
        rotation=abs(math.atan2(math.sin(robot['heading']-heading),math.cos(robot['heading']-heading)))
        assert rotation <= engine.motion.turn_rate_rad_s*.1+1e-8
        if rotation>1e-6:
            assert delta == 0
        if path[-1][1]>2 and robot['position'][2]>2.5:
            assert robot['position'][0] == pytest.approx(11.5)
    assert ticks<4000
    assert robot['position']==pytest.approx([path[-1][0]+.5,0,path[-1][1]+.5])
    assert robot['velocity']==0
    assert top_speed==pytest.approx(robot['max_speed'])
    assert ticks*.1==pytest.approx(estimate,abs=.2)
    end=robot['position'][:]
    for _ in range(20):engine._move_along_path(robot,rt)
    assert robot['position']==end


def test_motion_configuration_rejects_wrong_units_and_nonfinite_values():
    with pytest.raises(ValueError): MotionConfig(max_speed_mps=float('nan'))
    with pytest.raises(ValueError): MotionConfig(acceleration_mps2=0)
    layout=load_layout();layout['units']='scene'
    with pytest.raises(ValueError,match='1 m'): SimEngine(layout)


def test_pick_progress_only_advances_with_operational_dwell(route_robot):
    engine,r,rt=route_robot
    task=engine.create_task('PICK','NORMAL','SHELF-A01','PACK-01')
    r.update(current_task_id=task['id'],fsm='PICKING',operation_duration_ticks=40,operation_elapsed_ticks=0)
    rt.dwell=40
    for i in range(39):
        engine._step_robot(r,rt)
        assert r['fsm']=='PICKING' and r['operation_elapsed_ticks']==i+1
        assert r['load']['current']==0
    engine._step_robot(r,rt)
    assert r['fsm']=='TRANSPORTING' and r['load']['current']>0


def test_pause_speed_and_reset_share_authoritative_control():
    import asyncio
    from app.main import TwinServer
    server=TwinServer(db_path=':memory:')
    server.clock.reset()
    asyncio.run(server.control('PAUSE', .25))
    assert server.paused and server.full_message()['state']['sim']['mode']=='PAUSED'
    asyncio.run(server.control('PLAY', .5))
    assert not server.paused and server.full_message()['state']['sim']['speed']==.5
    asyncio.run(server.control('RESET'))
    assert server.speed==1 and server.engine.state['sim']['tick']==0
    assert server.clock.pending_s==0


def test_walkway_eta_uses_the_route_speed_limit(route_robot):
    engine,r,rt=route_robot
    r.update(path=[[x,2] for x in range(3,15)],path_index=0)
    rt.target=(14,2)
    for x in range(3,15): engine.grid.cells[2*50+x]=2
    engine._update_eta(r)
    estimate=r['eta_s']
    ticks=0
    while rt.target is not None and ticks<1000:
        engine._move_along_path(r,rt);ticks+=1
    assert ticks*.1 == pytest.approx(estimate,abs=.2)
    assert r['position']==pytest.approx([14.5,0,2.5])


def test_yield_can_reverse_without_a_colliding_half_turn(route_robot):
    engine,r,rt=route_robot
    r.update(path=[[1,2]],path_index=0)
    rt.target=(1,2);rt.backing_off=True
    for _ in range(100):
        before=r['position'][:]
        engine._move_along_path(r,rt)
        assert r['heading']==0
        assert r['position'][2]==before[2]
        assert r['position'][0]<=before[0]
        if rt.target is None:break
    assert r['position']==pytest.approx([1.5,0,2.5])
    assert r['velocity']==0


def test_narrow_aisle_turn_stays_inside_walkable_cells(route_robot):
    engine,r,rt=route_robot
    engine.grid.cells=bytearray([1]*2500)
    path=[[x,2] for x in range(3,10)]+[[9,z] for z in range(3,10)]
    for x,z in [[2,2]]+path:engine.grid.cells[z*50+x]=0
    r.update(path=path,path_index=0);rt.target=(9,9)
    for _ in range(1000):
        engine._move_along_path(r,rt)
        x,z=r['position'][0],r['position'][2]
        assert engine.grid.cells[math.floor(z)*50+math.floor(x)]==0
        if z>2.5:assert x==pytest.approx(9.5)
        if rt.target is None:break
    assert rt.target is None


def test_lift_docking_uses_acceleration_braking_and_exact_arrival(route_robot):
    engine,r,_=route_robot
    speed=0.
    for _ in range(200):
        arrived=engine._micro_move(r,(6.5,2.5),.6)
        assert r['velocity']-speed<=engine.motion.acceleration_mps2*.1+1e-8
        assert speed-r['velocity']<=engine.motion.deceleration_mps2*.1+1e-8
        speed=r['velocity']
        if arrived:break
    assert arrived and r['position']==pytest.approx([6.5,0,2.5])
    assert r['velocity']==0
