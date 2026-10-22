from __future__ import annotations
from copy import deepcopy
from dataclasses import dataclass, replace

from warehouse_core.prediction.duration import quantize
from warehouse_core.simulation.invariants import assert_invariants
from warehouse_core.telemetry.recorder import Recorder


@dataclass(frozen=True)
class Evaluation:
    score: float
    open_orders: int
    feasible: bool
    order_ids: tuple[str, ...]
    predicted_completion_s: dict[str, float | None]


class CandidateEvaluator:
    """Frozen decision cohort; no future arrivals/incidents or unobserved service times."""
    def __init__(self, engine):
        self.order_ids = tuple(sorted(o.id for o in engine.state.orders.values() if o.completed_s is None))
        self.base = deepcopy(engine, {id(engine.telemetry): Recorder()})
        self.base.scenario = replace(engine.scenario, orders=(), incidents=())
        self.base.next_order = self.base.next_incident = 0
        self.base.evaluation_mode = True
        self.base.validate = True
        # Replace hidden realized processing time with the predictor's observable estimate.
        for robot in self.base.state.robots.values():
            phase = robot.interrupted_state if robot.state == "FAILED" else robot.state
            if phase == "PICKING":
                predicted = self.base.predictor.pick_seconds(robot.zone_id, self.base.config)
                robot.remaining_s = quantize(max(self.base.config.tick_s,
                    predicted - (self.base.now - robot.phase_started_s)), self.base.config)
        c = engine.config
        # Same finite horizon for every candidate; unfinished difficult orders receive a penalty.
        items = sum(len(engine.state.orders[oid].item_ids) for oid in self.order_ids)
        worst = max(2*z.pick_distance_m/c.robot_speed_mps for z in c.zones) + c.pick_s + c.drop_s + c.packing_s + c.packing_per_item_s + c.belt_length_m/c.belt_speed_mps + c.charge_s
        self.horizon_s = max(120.0, min(7200.0, items * worst + 120))

    def evaluate(self, plan):
        sim = deepcopy(self.base)
        sim.plan = plan
        # Remove only noncommitted tentative transfers; preserve accepted motion and near commitments.
        for tid, r in list(sim.book.entries.items()):
            if sim.state.tasks[tid].status not in {"IN_TRANSIT", "DELIVERED"} and r.entry_s > sim.now + sim.config.commitment_s:
                sim.book.cancel(tid)
        try:
            sim.run(sim.now + self.horizon_s)
            assert_invariants(sim)
        except (AssertionError, ValueError):
            return Evaluation(float("inf"), len(self.order_ids), False, self.order_ids, {})
        completed = {oid: sim.state.orders[oid].completed_s for oid in self.order_ids}
        values = [(end - sim.state.orders[oid].arrival_s if end is not None else
                   sim.now - sim.state.orders[oid].arrival_s + self.horizon_s) for oid, end in completed.items()]
        return Evaluation(sum(values)/len(values) if values else 0.0,
                          sum(t is None for t in completed.values()), True, self.order_ids, completed)

