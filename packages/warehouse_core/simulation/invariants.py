from warehouse_core.resources.buffers import local_claims


def assert_invariants(engine):
    s, c = engine.state, engine.config
    assert sum(s.consolidation.values()) <= c.consolidation_slots, "consolidation overflow"
    for z in c.zones:
        assert local_claims(s, z.id) <= z.buffer_slots, "local buffer overflow"
    active = [r.task_id for r in s.robots.values() if r.task_id]
    assert len(active) == len(set(active)), "task assigned twice"
    for r in s.robots.values():
        if r.task_id:
            assert s.tasks[r.task_id].robot_id == r.id and s.tasks[r.task_id].status == "PREPARING"
    carriers = list(s.carriers.values())
    assert len({p.item_id for p in carriers}) == len(carriers), "duplicated item carrier"
    belt = sorted((p for p in carriers if p.state == "ON_BELT"), key=lambda p: p.position_m)
    for a, b in zip(belt, belt[1:]):
        assert b.position_m - a.position_m >= c.carrier_length_m+c.safe_gap_m-1e-7, "unsafe belt separation"
    expected_items = [iid for o in s.orders.values() for iid in o.item_ids]
    assert len(expected_items) == len(set(expected_items)) and set(expected_items) == set(s.items), "lost/duplicated items"
    assert {t.item_id for t in s.tasks.values()} == set(s.items) and len(s.tasks) == len(s.items)
    for item in s.items.values():
        task = s.tasks[f"T:{item.id}"]
        carrier = s.carriers.get(f"C:{item.id}")
        if item.location == "SHELF":
            assert task.status in {"QUEUED", "PREPARING"} and carrier is None
        elif item.location in s.robots:
            assert s.robots[item.location].task_id == task.id and carrier is None
        elif item.location.startswith("BUFFER:"):
            assert carrier and carrier.state == "LOCAL_BUFFER" and task.status == "READY"
        elif item.location.startswith("C:"):
            assert carrier and carrier.state == "ON_BELT" and task.status == "IN_TRANSIT"
        elif item.location == "CONSOLIDATION":
            assert carrier and carrier.state == "CONSOLIDATION" and item.order_id in s.consolidation
        elif item.location == "PACKAGE":
            package = s.packages[f"PKG:{item.order_id}"]
            assert item.id in package.item_ids and carrier and carrier.state == "CONSUMED"
        else:
            raise AssertionError(f"unknown item location {item.location}")
    occupied = [p.order_id for p in s.packing.values() if p.order_id]
    assert len(occupied) == len(set(occupied)), "order packed twice"
    for order in s.orders.values():
        if order.status in {"WAITING_PACKING", "PACKING"}:
            assert all(s.items[i].location == "CONSOLIDATION" for i in order.item_ids), "packing incomplete order"
        if order.status == "COMPLETED":
            assert order.packing_started_s is not None and order.completed_s > order.packing_started_s
            assert set(s.packages[f"PKG:{order.id}"].item_ids) == set(order.item_ids)
            assert order.id not in s.consolidation
        elif order.admitted_s is not None:
            assert s.consolidation[order.id] == len(order.item_ids)
    for t in s.tasks.values():
        if t.status in {"READY", "IN_TRANSIT", "DELIVERED"}:
            assert t.started_s is not None and t.completed_s is not None and t.completed_s > t.started_s

