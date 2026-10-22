from warehouse_core.planning.reservations import Reservation


def refresh_active_reservations(engine):
    """Preserve accepted carriers at their actual positions, also after belt stops."""
    for carrier in engine.state.carriers.values():
        if carrier.state != "ON_BELT":
            continue
        zone = engine.zones[carrier.zone_id]
        equivalent_entry = engine.now - (carrier.position_m - zone.entry_m) / engine.config.belt_speed_mps
        crossings = engine.book.crossings(zone.id, equivalent_entry)
        engine.book.entries[carrier.task_id] = Reservation(carrier.task_id, carrier.order_id, zone.id,
                                                          equivalent_entry, max(crossings.values()), crossings, True)


def enter_ready_carriers(engine):
    if engine.state.belt_stopped_until_s is not None:
        return
    s, c = engine.state, engine.config
    for task_id, reservation in sorted(list(engine.book.entries.items()), key=lambda pair: (pair[1].entry_s, pair[0])):
        task = s.tasks[task_id]
        if task.status != "READY" or reservation.entry_s > engine.now + 1e-8:
            continue
        start = engine.zones[task.zone_id].entry_m
        # Independent execution-time guard: even a corrupted/obsolete plan cannot bypass physics.
        occupied = any(p.state == "ON_BELT" and abs(p.position_m-start) < c.carrier_length_m+c.safe_gap_m-1e-8
                       for p in s.carriers.values())
        if occupied or task.order_id not in s.consolidation:
            engine.book.cancel(task_id)
            engine.telemetry.reservation_misses += 1
            engine.emit("RESERVATION_INVALID", task_id=task_id, reason="entry spacing or destination capacity")
            engine.replan_reason = "physical_repair"
            continue
        carrier = s.carriers[f"C:{task.item_id}"]
        carrier.state, carrier.entered_s, carrier.position_m = "ON_BELT", engine.now, start
        task.status = "IN_TRANSIT"
        s.items[task.item_id].location = carrier.id
        reservation.committed = True
        engine.emit("BELT_ENTERED", carrier_id=carrier.id, item_id=carrier.item_id, order_id=carrier.order_id)


def advance_belt(engine):
    if engine.state.belt_stopped_until_s is not None:
        return
    for carrier in engine.state.carriers.values():
        if carrier.state != "ON_BELT":
            continue
        carrier.position_m = min(engine.config.belt_length_m,
                                 carrier.position_m + engine.config.belt_speed_mps * engine.config.tick_s)
        if carrier.position_m >= engine.config.belt_length_m - 1e-8:
            carrier.state, carrier.arrived_s = "CONSOLIDATION", engine.now
            engine.state.items[carrier.item_id].location = "CONSOLIDATION"
            engine.state.tasks[carrier.task_id].status = "DELIVERED"
            # Keep exit clearance until the complete carrier and safety gap clear the transfer.
            reservation = engine.book.entries.get(carrier.task_id)
            if reservation:
                reservation.exit_s = engine.now
                reservation.crossings[f"M{engine.config.belt_length_m:g}"] = engine.now
            engine.emit("COMPONENT_ARRIVED", carrier_id=carrier.id, item_id=carrier.item_id, order_id=carrier.order_id)
            engine.replan_reason = "component_arrived"

