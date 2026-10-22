from warehouse_core.domain.models import State
from warehouse_core.domain.config import Config


def local_claims(state: State, zone_id: str) -> int:
    """Reserve a destination slot before picking, so a loaded robot cannot deadlock."""
    return sum(t.zone_id == zone_id and t.status in {"PREPARING", "READY"} for t in state.tasks.values())


def admit_order(state: State, config: Config, order_id: str, now: float) -> bool:
    order = state.orders[order_id]
    if order_id in state.consolidation:
        return True
    slots = len(order.item_ids)
    if sum(state.consolidation.values()) + slots > config.consolidation_slots:
        return False
    state.consolidation[order_id] = slots
    order.status = "PREPARING"
    order.admitted_s = now
    return True

