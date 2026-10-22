from dataclasses import dataclass, field
import math


def percentile95(values: list[float]) -> float | None:
    return sorted(values)[math.ceil(0.95 * len(values)) - 1] if values else None


@dataclass
class Recorder:
    events: list[dict] = field(default_factory=list)
    decisions: list[dict] = field(default_factory=list)
    samples: list[dict] = field(default_factory=list)
    reservation_misses: int = 0
    reservation_revisions: int = 0
    max_local_claims: dict[str, int] = field(default_factory=dict)
    max_consolidation: int = 0

    def emit(self, now: float, kind: str, **data):
        self.events.append(dict(seq=len(self.events) + 1, time_s=now, kind=kind, **data))

    def metrics(self, state, now: float) -> dict:
        done = [o for o in state.orders.values() if o.completed_s is not None]
        times = [o.completed_s - o.arrival_s for o in done]
        open_orders = [o for o in state.orders.values() if o.completed_s is None]
        overdue = sum(o.completed_s > o.due_s for o in done)
        decision_times = [d["compute_ms"] for d in self.decisions]
        def average(name):
            return sum(s[name] for s in self.samples) / len(self.samples) if self.samples else 0
        return dict(time_s=now, arrived_orders=len(state.orders), completed_orders=len(done),
                    open_orders=len(open_orders), open_order_ids=[o.id for o in open_orders],
                    mean_completion_s=sum(times) / len(times) if times else None,
                    p95_completion_s=percentile95(times),
                    late_completed_ratio=overdue / len(done) if done else None,
                    overdue_open_orders=sum(now > o.due_s for o in open_orders),
                    mean_open_age_s=sum(now-o.arrival_s for o in open_orders)/len(open_orders) if open_orders else 0,
                    mean_task_queue=average("task_queue"), mean_packing_queue=average("packing_queue"),
                    mean_local_occupancy=average("local_occupancy"),
                    mean_consolidation_reserved=average("consolidation_reserved"),
                    max_consolidation_reserved=self.max_consolidation,
                    max_local_claims=self.max_local_claims,
                    reservation_misses=self.reservation_misses, reservation_revisions=self.reservation_revisions,
                    decisions=len(self.decisions),
                    mean_decision_ms=sum(decision_times)/len(decision_times) if decision_times else 0,
                    p95_decision_ms=percentile95(decision_times),
                    evaluations=sum(d["evaluations"] for d in self.decisions))
