from dataclasses import asdict
from warehouse_core.resources.robots import ready_estimate


def snapshot(engine):
    s, c = engine.state, engine.config
    orders = []
    for o in s.orders.values():
        value = asdict(o)
        value["missing_item_ids"] = [i for i in o.item_ids if s.items[i].location not in {"CONSOLIDATION", "PACKAGE"}]
        value["wait_reason"] = ("consolidation_capacity" if o.status == "WAITING_ADMISSION" else
            "packing_capacity_or_outage" if o.status == "WAITING_PACKING" else
            "packing_in_progress" if o.status == "PACKING" else "awaiting_components" if o.status == "PREPARING" else None)
        orders.append(value)
    robots = []
    for r in s.robots.values():
        value = asdict(r)
        value.pop("remaining_s")  # Realized future pick duration is intentionally private.
        value["position"] = [engine.zones[r.zone_id].entry_m + r.lane*1.5, 0, -3-r.distance_m]
        value["estimated_ready_s"] = ready_estimate(engine, s.tasks[r.task_id]) if r.task_id else None
        robots.append(value)
    return dict(schema_version="2.0", tick=s.tick, time_s=engine.now, tick_s=c.tick_s,
        policy=engine.policy, scenario=engine.scenario.name, scenario_seed=engine.scenario.scenario_seed,
        algorithm_seed=engine.algorithm_seed, config=c.to_dict(), orders=orders,
        items=[asdict(v) for v in s.items.values()], tasks=[asdict(v) for v in s.tasks.values()],
        robots=robots, carriers=[asdict(v) for v in s.carriers.values()],
        packages=[asdict(v) for v in s.packages.values()], packing=[asdict(v) for v in s.packing.values()],
        zones=[a.observe(engine) for a in engine.agents],
        belt=dict(stopped=s.belt_stopped_until_s is not None, restore_at_s=s.belt_stopped_until_s),
        consolidation=dict(reserved_slots=sum(s.consolidation.values()), capacity_slots=c.consolidation_slots,
                           orders=dict(s.consolidation)),
        reservations=engine.book.dump(), events=engine.telemetry.events[-100:],
        decisions=engine.telemetry.decisions[-10:], metrics=engine.telemetry.metrics(s, engine.now),
        finished=engine.finished)
