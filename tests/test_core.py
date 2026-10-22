from copy import deepcopy
from pathlib import Path
import pytest

from warehouse_core.domain.config import Config, ZoneConfig
from warehouse_core.simulation.engine import Simulation
from warehouse_core.simulation.scenario import load_scenario
from warehouse_core.simulation.invariants import assert_invariants
from warehouse_core.planning.reservations import ReservationBook
from warehouse_core.optimization.evaluation import CandidateEvaluator
from warehouse_core.policies.reference import fifo

ROOT = Path(__file__).resolve().parents[1]


def small(**extra):
    return load_scenario(dict(orders=[dict(id="A", zones=["Z1", "Z4"], due_s=120)], **extra))


def test_single_order_conservation_and_real_packing_sequence():
    engine = Simulation(small())
    metrics = engine.run()
    assert metrics["completed_orders"] == 1 and not metrics["open_orders"]
    events = engine.telemetry.events
    arrived = [e["time_s"] for e in events if e["kind"] == "COMPONENT_ARRIVED"]
    start = next(e["time_s"] for e in events if e["kind"] == "PACKING_STARTED")
    finish = next(e["time_s"] for e in events if e["kind"] == "PACKING_COMPLETED")
    assert len(arrived) == 2 and start >= max(arrived) and finish-start == 10
    assert len(engine.state.items) == 2 and len(engine.state.carriers) == 2 and len(engine.state.packages) == 1
    assert_invariants(engine)


def test_downstream_merge_conflict_and_atomic_rollback():
    book = ReservationBook(Config())
    a = book.reserve("A", "O1", "Z1", 0, True, 0)
    # Entries 12m apart: equal downstream arrival would collide despite both entries being empty now.
    b = book.reserve("B", "O2", "Z2", 12, True, 0)
    assert b.entry_s >= 12+book.headway_s
    assert abs(a.crossings["M24"]-b.crossings["M24"]) >= book.headway_s
    before = deepcopy(book.dump())
    assert book.reserve("C", "O3", "Z3", 1, False, 0) is None
    assert before == book.dump()
    constrained = ReservationBook(Config(reservation_horizon_s=0.5))
    assert constrained.reserve("A", "O1", "Z1", 0, True, 0)
    assert constrained.reserve("B", "O2", "Z1", 0, True, 0) is None
    assert set(constrained.entries) == {"A"}


def test_full_buffer_and_admission_reserves_whole_order():
    engine = Simulation(load_scenario(ROOT/"experiments/scenarios/limited_buffer.json"))
    metrics = engine.run()
    assert metrics["completed_orders"] == 10
    assert metrics["max_consolidation_reserved"] <= 4
    assert max(metrics["max_local_claims"].values()) <= 1
    admitted = [e for e in engine.telemetry.events if e["kind"] == "ORDER_ADMITTED"]
    finished = [e for e in engine.telemetry.events if e["kind"] == "PACKING_COMPLETED"]
    assert all(a["slots"] == 4 for a in admitted)
    assert admitted[1]["time_s"] >= finished[0]["time_s"]


def test_missing_component_prevents_packing_and_reports_open_order():
    engine = Simulation(small())
    engine.inject("ROBOT_FAILURE", "Z1-R1", 500)
    engine.inject("ROBOT_FAILURE", "Z1-R2", 500)
    engine.run(100)
    assert len(engine.state.packages) == 0
    assert engine.state.items["A:I2"].location == "CONSOLIDATION"
    assert not any(e["kind"] == "PACKING_STARTED" for e in engine.telemetry.events)
    assert engine.snapshot()["metrics"]["open_order_ids"] == ["A"]


def test_robot_failure_preserves_payload_and_resumes_same_task():
    engine = Simulation(small())
    while not any(r.state == "CARRYING" for r in engine.state.robots.values()):
        engine.step()
    robot = next(r for r in engine.state.robots.values() if r.state == "CARRYING")
    task_id, position = robot.task_id, robot.distance_m
    engine.inject("ROBOT_FAILURE", robot.id, 10)
    engine.step(10)
    assert robot.state == "FAILED" and robot.distance_m == position and robot.task_id == task_id
    engine.run()
    assert len(engine.state.packages) == 1
    assert sum(e["kind"] == "ITEM_PICKED" and e.get("task_id") == task_id for e in engine.telemetry.events) == 1


def test_belt_stop_freezes_motion_cancels_future_and_restarts_safely():
    engine = Simulation(load_scenario(ROOT/"experiments/scenarios/balanced.json"))
    engine.step(35)
    active = {p.id:p.position_m for p in engine.state.carriers.values() if p.state == "ON_BELT"}
    assert active
    engine.inject("BELT_STOP", duration_s=10)
    assert all(engine.state.tasks[tid].status == "IN_TRANSIT" for tid in engine.book.entries)
    engine.step(20)
    assert all(engine.state.carriers[cid].position_m == x for cid,x in active.items())
    engine.run()
    assert engine.finished and len(engine.state.packages) == 12


def test_packing_outage_preserves_work():
    engine = Simulation(small(config={"packing_stations":1}))
    while engine.state.packing["P1"].order_id is None:
        engine.step()
    remaining = engine.state.packing["P1"].remaining_s
    engine.inject("PACKING_FAILURE", "P1", 10)
    engine.step(20)
    assert engine.state.packing["P1"].remaining_s == remaining
    engine.run()
    assert len(engine.state.packages) == 1


@pytest.mark.parametrize("name", [p.stem for p in (ROOT/"experiments/scenarios").glob("*.json")])
def test_all_scenarios_finish_with_invariants_each_tick(name):
    engine = Simulation(load_scenario(ROOT/f"experiments/scenarios/{name}.json", 13))
    assert engine.run()["open_orders"] == 0


@pytest.mark.parametrize("policy", ["fifo", "order_aware", "gwo_conveyor", "local_search", "gwo_integrated"])
def test_determinism_fixed_budget_and_separate_seeds(policy):
    scenario = load_scenario(dict(orders=[dict(id="A",zones=["Z1","Z4"]),dict(id="B",zones=["Z1","Z2"])],
                                  config={"preparation_cv":0.5}))
    a, b = [Simulation(scenario, policy, 19, 4) for _ in range(2)]
    a.run(); b.run()
    assert a.state == b.state and a.telemetry.events == b.telemetry.events
    assert [{k:v for k,v in d.items() if k != "compute_ms"} for d in a.telemetry.decisions] == [
        {k:v for k,v in d.items() if k != "compute_ms"} for d in b.telemetry.decisions]
    assert all(d["evaluations"] <= 4 for d in a.telemetry.decisions)
    if policy == "gwo_conveyor":
        for d in a.telemetry.decisions:
            assert all(c["preparation"] == d["preparation"] for c in d["candidates"])


def test_candidate_evaluation_isolated_and_cannot_see_future_or_realized_pick_time():
    scenario = load_scenario(dict(orders=[dict(id="A",zones=["Z1","Z4"]),
        dict(id="FUTURE",arrival_s=100,zones=["Z2"])],
        incidents=[dict(kind="BELT_STOP",at_s=90,duration_s=300)], config={"preparation_cv":0.7}))
    engine = Simulation(scenario)
    engine.step(10)
    before = deepcopy(engine.state), deepcopy(engine.book.dump()), deepcopy(engine.telemetry.events), engine.search_rng.getstate()
    evaluator = CandidateEvaluator(engine)
    plan = fifo(engine.state, engine.now)
    result = evaluator.evaluate(plan)
    assert result.order_ids == ("A",) and result.feasible
    assert before == (engine.state, engine.book.dump(), engine.telemetry.events, engine.search_rng.getstate())
    for r in engine.state.robots.values():
        if r.state == "PICKING":
            r.remaining_s = 10000  # hidden truth must not change the candidate's prediction
    assert CandidateEvaluator(engine).evaluate(plan) == result


def test_invariant_checker_detects_corruption():
    engine = Simulation(small()); engine.run()
    engine.state.packages["PKG:A"].item_ids.pop()
    with pytest.raises(AssertionError):
        assert_invariants(engine)


def test_delay_revises_reservations():
    engine = Simulation(load_scenario(ROOT/"experiments/scenarios/preparation_uncertainty.json"))
    engine.run()
    assert engine.telemetry.reservation_revisions > 0
    assert any(e["kind"] == "RESERVATION_REVISED" for e in engine.telemetry.events)


@pytest.mark.parametrize("config", [{"tick_s":0},{"belt_speed_mps":float('nan')},{"consolidation_slots":0}])
def test_invalid_physics_rejected(config):
    with pytest.raises(ValueError): Config.from_dict(config)


@pytest.mark.parametrize("policy", ["gwo_conveyor", "gwo_integrated", "local_search"])
def test_search_keeps_best_feasible_candidate_and_uses_warm_start(policy):
    from warehouse_core.optimization.search import search
    from warehouse_core.optimization.representation import Priorities
    engine = Simulation(small(), policy, search_budget=7)
    base = fifo(engine.state, engine.now)
    previous = Priorities(tuple(reversed(base.preparation)), tuple(reversed(base.conveyor)))
    engine.plan = previous
    result = search(engine, base)
    assert result.evaluations == 7
    assert result.score == min(c["score"] for c in result.candidates if c["feasible"])
    assert result.candidates[0]["conveyor"] == list(previous.conveyor)
    assert result.cohort == ["A"]
    assert not engine.book.entries and not engine.state.carriers


def test_unfinished_candidate_orders_are_penalized_instead_of_excluded():
    engine = Simulation(small())
    engine.inject("ROBOT_FAILURE", "Z1-R1", 10000)
    engine.inject("ROBOT_FAILURE", "Z1-R2", 10000)
    evaluator = CandidateEvaluator(engine)
    result = evaluator.evaluate(fifo(engine.state, engine.now))
    assert result.order_ids == ("A",) and result.open_orders == 1
    assert result.predicted_completion_s == {"A":None}
    assert result.score >= evaluator.horizon_s*2


def test_charging_precludes_task_assignment_and_keeps_items():
    engine = Simulation(load_scenario(dict(config={"battery_tasks":1,"charge_s":4},
        orders=[dict(id=f"O{i}",zones=["Z1"]) for i in range(5)])))
    engine.run()
    phases=[e for e in engine.telemetry.events if e["kind"]=="ROBOT_PHASE" and e["phase"]=="CHARGING"]
    assert phases and all(e["task_id"] is None for e in phases)
    assert len(engine.state.packages)==5


def test_invariant_checker_detects_spacing_and_duplicate_carrier():
    from warehouse_core.domain.models import Carrier
    engine=Simulation(small())
    while len([p for p in engine.state.carriers.values() if p.state=="ON_BELT"])<2:
        engine.step()
    a,b=list(engine.state.carriers.values())
    original=b.position_m
    b.position_m=a.position_m+0.1
    with pytest.raises(AssertionError, match="separation"):
        assert_invariants(engine)
    b.position_m=original
    engine.state.carriers['duplicate']=Carrier('duplicate',a.item_id,a.order_id,a.zone_id,a.task_id)
    with pytest.raises(AssertionError,match="duplicated"):
        assert_invariants(engine)


def test_exit_clearance_protects_an_entry_close_to_the_destination():
    engine=Simulation(load_scenario(dict(config={"zones":[dict(id="Z1",entry_m=47.8,robots=2,buffer_slots=4)],
        "pick_s":0.5,"drop_s":0.5,"robot_speed_mps":20},
        orders=[dict(id=f"O{i}",zones=["Z1"]) for i in range(4)])))
    engine.run()
    times=[e['time_s'] for e in engine.telemetry.events if e['kind']=='COMPONENT_ARRIVED']
    assert len(times)==4
    assert all(b-a>=engine.book.headway_s for a,b in zip(times,times[1:]))
