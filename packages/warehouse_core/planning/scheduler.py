from warehouse_core.resources.conveyor import refresh_active_reservations
from warehouse_core.resources.robots import ready_estimate


def schedule_transfers(engine, rebuild=False):
    refresh_active_reservations(engine)
    s, c, now = engine.state, engine.config, engine.now
    if s.belt_stopped_until_s is not None:
        return
    # Keep near-term valid commitments. Cancel unsafe plans even inside commitment interval.
    for task_id, reservation in list(engine.book.entries.items()):
        task = s.tasks[task_id]
        if task.status == "IN_TRANSIT":
            continue
        if task.status == "DELIVERED":
            if reservation.exit_s + engine.book.headway_s <= now:
                engine.book.cancel(task_id)
            continue
        estimate = ready_estimate(engine, task)
        invalid = estimate > reservation.entry_s + 1e-8 or reservation.entry_s < now - 1e-8
        committed = reservation.entry_s <= now + c.commitment_s
        reservation.committed = committed
        if invalid or (rebuild and not committed):
            engine.book.cancel(task_id)
            if invalid:
                engine.telemetry.reservation_revisions += 1
                if reservation.entry_s <= now and task.status != "READY":
                    engine.telemetry.reservation_misses += 1
                engine.emit("RESERVATION_REVISED", task_id=task_id, old_entry_s=reservation.entry_s,
                            ready_estimate_s=estimate, reason="preparation_delay")
                engine.replan_reason = "preparation_delay"
    for task_id in engine.plan.conveyor:
        task = s.tasks.get(task_id)
        if task is None or task.status not in {"PREPARING", "READY"} or task_id in engine.book.entries:
            continue
        reservation = engine.book.reserve(task_id, task.order_id, task.zone_id, ready_estimate(engine, task),
                                          task.order_id in s.consolidation, now)
        if reservation:
            engine.emit("TRANSFER_RESERVED", **vars(reservation))

