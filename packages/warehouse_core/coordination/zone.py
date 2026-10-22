from dataclasses import dataclass
from warehouse_core.resources.buffers import local_claims
from warehouse_core.resources.robots import choose_robot, start_task, ready_estimate


@dataclass(frozen=True)
class ZoneAgent:
    zone_id: str

    def dispatch(self, engine, priorities):
        zone = engine.zones[self.zone_id]
        for task_id in priorities:
            task = engine.state.tasks.get(task_id)
            if task is None or task.zone_id != self.zone_id or task.status != "QUEUED":
                continue
            if task.order_id not in engine.state.consolidation or local_claims(engine.state, self.zone_id) >= zone.buffer_slots:
                continue
            robot = choose_robot([r for r in engine.state.robots.values() if r.zone_id == self.zone_id and r.state == "IDLE"])
            if robot is None:
                break
            start_task(engine, task, robot)

    def observe(self, engine):
        tasks = [t for t in engine.state.tasks.values() if t.zone_id == self.zone_id]
        return dict(id=self.zone_id, queued=sum(t.status == "QUEUED" for t in tasks),
                    local_claims=local_claims(engine.state, self.zone_id),
                    buffer_occupancy=sum(t.status == "READY" for t in tasks),
                    buffer_slots=engine.zones[self.zone_id].buffer_slots,
                    robot_ids=[r.id for r in engine.state.robots.values() if r.zone_id == self.zone_id],
                    ready_estimates={t.id: ready_estimate(engine, t) for t in tasks if t.status in {"PREPARING", "READY"}})

