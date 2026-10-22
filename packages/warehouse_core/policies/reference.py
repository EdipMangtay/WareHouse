from warehouse_core.domain.models import State
from warehouse_core.optimization.representation import Priorities


def fifo(state: State, now: float) -> Priorities:
    ids = sorted((t.id for t in state.tasks.values() if t.status != "DELIVERED"),
                 key=lambda tid: (state.orders[state.tasks[tid].order_id].arrival_s, tid))
    return Priorities(tuple(ids), tuple(ids))


def order_aware(state: State, now: float) -> Priorities:
    """Prefer the last missing component; then older orders; stable ID tie-break."""
    missing = {o.id: sum(state.items[i].location not in {"CONSOLIDATION", "PACKAGE"} for i in o.item_ids)
               for o in state.orders.values()}
    base = fifo(state, now)
    ids = tuple(sorted(base.preparation, key=lambda tid: (
        missing[state.tasks[tid].order_id] != 1,
        -(now - state.orders[state.tasks[tid].order_id].arrival_s),
        missing[state.tasks[tid].order_id], tid)))
    return Priorities(ids, ids)

