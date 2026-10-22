from time import perf_counter

from warehouse_core.policies.reference import fifo, order_aware
from warehouse_core.resources.buffers import admit_order
from warehouse_core.planning.scheduler import schedule_transfers


def coordinate(engine):
    s, now = engine.state, engine.now
    replan = not engine.evaluation_mode and (engine.replan_reason or now-engine.last_replan_s >= engine.config.replan_s)
    if replan:
        started = perf_counter()
        baseline = fifo(s, now) if engine.policy in {"fifo", "gwo_conveyor"} else order_aware(s, now)
        reason = engine.replan_reason or "periodic"
        if engine.policy in {"fifo", "order_aware"} or len(baseline.preparation) < 2:
            engine.plan = baseline
            evaluations, score, candidates, fallback = 0, None, [], False
            cohort = sorted(o.id for o in s.orders.values() if o.completed_s is None)
        else:
            from warehouse_core.optimization.search import search
            result = search(engine, baseline)
            engine.plan = result.plan
            evaluations, score, candidates, fallback = result.evaluations, result.score, result.candidates, result.fallback
            cohort = result.cohort
        decision = dict(id=f"D{len(engine.telemetry.decisions)+1}", time_s=now, policy=engine.policy,
                        trigger=reason, preparation=list(engine.plan.preparation), conveyor=list(engine.plan.conveyor),
                        cohort=cohort, evaluations=evaluations, score=score, candidates=candidates,
                        compute_ms=(perf_counter()-started)*1000, fallback=fallback,
                        budget=engine.search_budget, time_limit_ms=engine.time_limit_ms,
                        explanation=("Arrival time then task ID" if engine.policy == "fifo" else
                            "Preparation FIFO fixed; GWO searches conveyor order" if engine.policy == "gwo_conveyor" else
                            "Last missing component, then order age and stable ID" if engine.policy == "order_aware" else
                            "Joint preparation/conveyor search using isolated physical rollouts"),
                        robot_rule="shortest travel, fewest jobs, robot ID",
                        commitment_s=engine.config.commitment_s)
        engine.telemetry.decisions.append(decision)
        engine.emit("PLAN_SELECTED", decision_id=decision["id"], trigger=reason, evaluations=evaluations)
        engine.last_replan_s, engine.replan_reason = now, None
    # Admission follows preparation order; all components are reserved atomically.
    for oid in dict.fromkeys(s.tasks[tid].order_id for tid in engine.plan.preparation if tid in s.tasks):
        if s.orders[oid].status == "WAITING_ADMISSION" and admit_order(s, engine.config, oid, now):
            engine.emit("ORDER_ADMITTED", order_id=oid, slots=len(s.orders[oid].item_ids))
    for agent in engine.agents:
        agent.dispatch(engine, engine.plan.preparation)
    schedule_transfers(engine, rebuild=bool(replan))

