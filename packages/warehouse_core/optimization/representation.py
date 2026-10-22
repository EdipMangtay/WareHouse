from __future__ import annotations
from dataclasses import dataclass


@dataclass(frozen=True)
class Priorities:
    preparation: tuple[str, ...]
    conveyor: tuple[str, ...]

    def adapt(self, task_ids: list[str]) -> Priorities:
        valid = set(task_ids)
        def complete(old):
            return tuple(dict.fromkeys([x for x in old if x in valid] + task_ids))
        return Priorities(complete(self.preparation), complete(self.conveyor))


def decode(keys: list[float], task_ids: list[str], fixed_preparation: tuple[str, ...] | None = None) -> Priorities:
    n = len(task_ids)
    def permutation(values):
        return tuple(task_ids[i] for i in sorted(range(n), key=lambda i: (values[i], task_ids[i])))
    return (Priorities(fixed_preparation, permutation(keys)) if fixed_preparation is not None
            else Priorities(permutation(keys[:n]), permutation(keys[n:])))


def encode(plan: Priorities, task_ids: list[str], conveyor_only: bool = False) -> list[float]:
    def keys(order):
        ranks = {tid: i / max(1, len(order)) for i, tid in enumerate(order)}
        return [ranks[tid] for tid in task_ids]
    return keys(plan.conveyor) if conveyor_only else keys(plan.preparation) + keys(plan.conveyor)

