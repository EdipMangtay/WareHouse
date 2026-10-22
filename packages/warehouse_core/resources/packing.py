from warehouse_core.domain.models import CustomerPackage
from warehouse_core.prediction.duration import quantize


def start_packing(engine):
    s, c = engine.state, engine.config
    for order in sorted(s.orders.values(), key=lambda o: (o.arrival_s, o.id)):
        if order.status not in {"PREPARING", "WAITING_PACKING"}:
            continue
        if not all(s.items[i].location == "CONSOLIDATION" for i in order.item_ids):
            continue
        order.status = "WAITING_PACKING"
        station = next((p for p in s.packing.values() if p.order_id is None and p.failed_until_s is None), None)
        if station is None:
            continue
        station.order_id = order.id
        station.remaining_s = quantize(c.packing_s + len(order.item_ids) * c.packing_per_item_s, c)
        order.status, order.packing_started_s = "PACKING", engine.now
        engine.emit("PACKING_STARTED", order_id=order.id, station_id=station.id, item_ids=list(order.item_ids))


def advance_packing(engine):
    s = engine.state
    for station in s.packing.values():
        if station.order_id is None or station.failed_until_s is not None:
            continue
        station.remaining_s = max(0, station.remaining_s - engine.config.tick_s)
        if station.remaining_s > 1e-8:
            continue
        order = s.orders[station.order_id]
        assert all(s.items[i].location == "CONSOLIDATION" for i in order.item_ids)
        order.status, order.completed_s = "COMPLETED", engine.now
        pid = f"PKG:{order.id}"
        s.packages[pid] = CustomerPackage(pid, order.id, list(order.item_ids), engine.now)
        for item_id in order.item_ids:
            s.items[item_id].location = "PACKAGE"
            s.carriers[f"C:{item_id}"].state = "CONSUMED"
        del s.consolidation[order.id]
        station.order_id = None
        engine.emit("PACKING_COMPLETED", order_id=order.id, package_id=pid,
                    flow_time_s=order.completed_s-order.arrival_s)
        engine.replan_reason = "capacity_released"

