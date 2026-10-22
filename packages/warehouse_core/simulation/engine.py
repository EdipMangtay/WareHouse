from __future__ import annotations
import hashlib
import math
import random

from warehouse_core.domain.models import State, Robot, PackingStation, Order, Item, PickTask
from warehouse_core.coordination.zone import ZoneAgent
from warehouse_core.optimization.representation import Priorities
from warehouse_core.planning.reservations import ReservationBook
from warehouse_core.prediction import HistoricalPredictor
from warehouse_core.resources.robots import advance_robots
from warehouse_core.resources.conveyor import enter_ready_carriers, advance_belt
from warehouse_core.resources.packing import start_packing, advance_packing
from warehouse_core.telemetry.recorder import Recorder
from .scenario import Scenario


class Simulation:
    def __init__(self, scenario: Scenario, policy: str = "fifo", algorithm_seed: int = 7,
                 search_budget: int = 12, time_limit_ms: float | None = None, validate: bool = True):
        from warehouse_core.policies import POLICIES
        if policy not in POLICIES or search_budget < 1 or search_budget > 10000:
            raise ValueError("unknown policy or invalid search budget")
        if time_limit_ms is not None and (not math.isfinite(time_limit_ms) or time_limit_ms <= 0):
            raise ValueError("time_limit_ms must be positive")
        self.scenario, self.config = scenario, scenario.config
        self.policy, self.algorithm_seed = policy, algorithm_seed
        self.search_budget, self.time_limit_ms = search_budget, time_limit_ms
        self.search_rng = random.Random(algorithm_seed)
        self.state = State()
        self.zones = {z.id: z for z in self.config.zones}
        self.agents = [ZoneAgent(z.id) for z in self.config.zones]
        self.state.robots = {f"{z.id}-R{i+1}": Robot(f"{z.id}-R{i+1}", z.id, i)
                             for z in self.config.zones for i in range(z.robots)}
        self.state.packing = {f"P{i+1}": PackingStation(f"P{i+1}") for i in range(self.config.packing_stations)}
        self.book, self.telemetry = ReservationBook(self.config), Recorder()
        self.predictor = HistoricalPredictor()
        self.plan = Priorities((), ())
        self.next_order = self.next_incident = 0
        self.replan_reason, self.last_replan_s = "initial", -math.inf
        self.validate, self.evaluation_mode = validate, False
        self._arrivals()

    @property
    def now(self) -> float:
        return round(self.state.tick * self.config.tick_s, 9)

    def emit(self, kind, **data):
        if not self.evaluation_mode:
            self.telemetry.emit(self.now, kind, **data)

    def _arrivals(self):
        while self.next_order < len(self.scenario.orders) and self.scenario.orders[self.next_order]["arrival_s"] <= self.now + 1e-8:
            self.add_order(self.scenario.orders[self.next_order])
            self.next_order += 1

    def add_order(self, spec: dict):
        oid = str(spec["id"])
        components = list(spec["zones"])
        arrival = float(spec.get("arrival_s", self.now))
        due = float(spec.get("due_s", self.now+120))
        if oid in self.state.orders or not oid or not components or len(components) > self.config.consolidation_slots:
            raise ValueError("duplicate order or invalid component count")
        if any(z not in self.zones for z in components) or not 0 <= arrival <= self.now or not math.isfinite(due) or due < arrival:
            raise ValueError("invalid zones or order times")
        ids = [f"{oid}:I{i+1}" for i in range(len(components))]
        self.state.orders[oid] = Order(oid, arrival, due, ids)
        for iid, zone in zip(ids, components):
            self.state.items[iid] = Item(iid, f"SKU:{zone}", oid, zone)
            tid = f"T:{iid}"
            self.state.tasks[tid] = PickTask(tid, oid, iid, zone)
        self.emit("ORDER_ARRIVED", order_id=oid, item_ids=ids)
        self.replan_reason = "new_order"

    def pick_duration(self, task):
        if self.evaluation_mode:
            return self.predictor.pick_seconds(task.zone_id, self.config)
        # Stable per item common random numbers, independent of dispatch order and algorithm seed.
        seed = f"{self.scenario.stream_seeds['preparation']}:{task.item_id}".encode()
        rng = random.Random(int.from_bytes(hashlib.sha256(seed).digest()[:8], "big"))
        cv = self.config.preparation_cv
        sigma = math.sqrt(math.log1p(cv*cv))
        return self.config.pick_s * rng.lognormvariate(-sigma*sigma/2, sigma)

    def inject(self, kind: str, target: str | None = None, duration_s: float = 20):
        if not math.isfinite(duration_s) or duration_s <= 0:
            raise ValueError("duration_s must be finite and positive")
        until = self.now + duration_s
        if kind == "BELT_STOP":
            self.state.belt_stopped_until_s = max(until, self.state.belt_stopped_until_s or 0)
            for tid in list(self.book.entries):
                if self.state.tasks[tid].status not in {"IN_TRANSIT", "DELIVERED"}:
                    self.book.cancel(tid)
                    self.emit("RESERVATION_CANCELLED", task_id=tid, reason="belt_stop")
        elif kind == "ROBOT_FAILURE" and target in self.state.robots:
            robot = self.state.robots[target]
            if robot.state != "FAILED":
                robot.interrupted_state, robot.state = robot.state, "FAILED"
            robot.failed_until_s = max(until, robot.failed_until_s or 0)
            if robot.task_id:
                self.book.cancel(robot.task_id)
        elif kind == "PACKING_FAILURE" and target in self.state.packing:
            station = self.state.packing[target]
            station.failed_until_s = max(until, station.failed_until_s or 0)
        else:
            raise ValueError("unknown disruption kind or target")
        self.emit("RESOURCE_INTERRUPTED", resource=target or "BELT", interruption=kind, until_s=until)
        self.replan_reason = "resource_interrupted"

    def _interruptions(self):
        while self.next_incident < len(self.scenario.incidents) and self.scenario.incidents[self.next_incident]["at_s"] <= self.now + 1e-8:
            incident = self.scenario.incidents[self.next_incident]
            self.inject(incident["kind"], incident.get("target"), incident["duration_s"])
            self.next_incident += 1
        if self.state.belt_stopped_until_s is not None and self.now >= self.state.belt_stopped_until_s:
            self.state.belt_stopped_until_s = None
            self.emit("RESOURCE_RESTORED", resource="BELT")
            self.replan_reason = "belt_restarted"
        for robot in self.state.robots.values():
            if robot.failed_until_s is not None and self.now >= robot.failed_until_s:
                robot.state, robot.interrupted_state = robot.interrupted_state or "IDLE", None
                robot.failed_until_s = None
                self.emit("RESOURCE_RESTORED", resource=robot.id)
                self.replan_reason = "robot_restored"
        for station in self.state.packing.values():
            if station.failed_until_s is not None and self.now >= station.failed_until_s:
                station.failed_until_s = None
                self.emit("RESOURCE_RESTORED", resource=station.id)
                self.replan_reason = "packing_restored"

    def step(self, count: int = 1):
        from warehouse_core.coordination.coordinator import coordinate
        from .invariants import assert_invariants
        if type(count) is not int or count < 0:
            raise ValueError("step count must be nonnegative integer")
        for _ in range(count):
            self._arrivals()
            self._interruptions()
            coordinate(self)
            enter_ready_carriers(self)
            start_packing(self)
            # Resource completions are timestamped at the END of the interval.
            self.state.tick += 1
            advance_robots(self)
            advance_belt(self)
            advance_packing(self)
            if self.validate:
                assert_invariants(self)
            if not self.evaluation_mode:
                self._sample()

    def _sample(self):
        from warehouse_core.resources.buffers import local_claims
        s = self.state
        claims = {z.id: local_claims(s, z.id) for z in self.config.zones}
        used = sum(s.consolidation.values())
        self.telemetry.max_consolidation = max(self.telemetry.max_consolidation, used)
        for z, n in claims.items():
            self.telemetry.max_local_claims[z] = max(n, self.telemetry.max_local_claims.get(z, 0))
        self.telemetry.samples.append(dict(time_s=self.now, task_queue=sum(t.status == "QUEUED" for t in s.tasks.values()),
            packing_queue=sum(o.status == "WAITING_PACKING" for o in s.orders.values()),
            local_occupancy=sum(t.status == "READY" for t in s.tasks.values()),
            consolidation_reserved=used, local_claims=claims))

    @property
    def finished(self):
        return self.next_order == len(self.scenario.orders) and all(o.completed_s is not None for o in self.state.orders.values())

    def run(self, until_s: float | None = None):
        end = self.scenario.horizon_s if until_s is None else until_s
        while self.now < end - 1e-8 and not self.finished:
            self.step()
        return self.telemetry.metrics(self.state, self.now)

    def snapshot(self):
        from warehouse_core.telemetry.snapshot import snapshot
        return snapshot(self)
