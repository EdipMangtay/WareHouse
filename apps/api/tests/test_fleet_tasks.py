from collections import Counter
from app.layout_generator import generate_layout
from app.sim.engine import SimEngine


def test_large_fleet_gets_real_jobs_in_every_zone_without_unbounded_queue():
    layout=generate_layout('large')
    assert len(layout['spawn']['robots'])==48
    assert Counter(r['home_zone'] for r in layout['spawn']['robots'])==dict(ZONE_A=11,ZONE_B=11,ZONE_C=11,ZONE_D=11,SERVICE=4)
    e=SimEngine(layout)
    for _ in range(12): e.step()
    assert all(r['current_task_id'] for r in e.state['robots'].values())
    assert len(e.state['tasks'])==48
    assert len(e.state['packages'])==48
    before=len(e.state['tasks'])
    e.next_task_tick=0
    e._generate_tasks()
    assert len(e.state['tasks'])==before
    # A sustained physical run must move carriers and accept cartons.
    for _ in range(1600): e.step()
    # Robots may have completed a pick and returned to their induction queue
    # at the spawn point; cumulative distance measures actual movement.
    assert sum(r['stats']['distance_m'] > 1 for r in e.state['robots'].values())>=40
    assert any(p['loaded_at'] is not None for p in e.state['packages'].values())
    assert len([t for t in e.state['tasks'].values() if t['status']=='WAITING'])<=48
