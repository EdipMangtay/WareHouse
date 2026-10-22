"""Exclusive robot phases on dedicated zone service lanes (metres and seconds)."""
from warehouse_core.domain.models import Carrier
from warehouse_core.prediction.duration import quantize


def choose_robot(robots):
    # Shared, deterministic rule: shortest travel to shelf, fewest jobs, stable ID.
    return min(robots, key=lambda r: (-r.distance_m, r.jobs_since_charge, r.id), default=None)


def start_task(engine, task, robot):
    now = engine.now
    task.status, task.robot_id, task.started_s = "PREPARING", robot.id, now
    robot.task_id = task.id
    set_phase(engine, robot, "ASSIGNED", engine.config.tick_s)
    engine.emit("TASK_ASSIGNED", task_id=task.id, order_id=task.order_id, robot_id=robot.id,
                reason="shortest travel, fewest jobs, stable robot ID")


def set_phase(engine, robot, phase, duration):
    robot.state, robot.remaining_s, robot.phase_started_s = phase, quantize(duration, engine.config), engine.now
    engine.emit("ROBOT_PHASE", robot_id=robot.id, task_id=robot.task_id, phase=phase)


def advance_robots(engine):
    c, s, dt = engine.config, engine.state, engine.config.tick_s
    for robot in s.robots.values():
        if robot.state == "FAILED":
            robot.phase_started_s += dt
            continue
        if robot.state in {"IDLE", "WAITING"}:
            continue
        zone = engine.zones[robot.zone_id]
        robot.remaining_s = max(0.0, robot.remaining_s - dt)
        if robot.state == "MOVING_TO_PICK":
            robot.distance_m = min(zone.pick_distance_m, robot.distance_m + c.robot_speed_mps * dt)
        elif robot.state == "CARRYING":
            robot.distance_m = max(0.0, robot.distance_m - c.robot_speed_mps * dt)
        if robot.remaining_s > 1e-8:
            continue
        task = s.tasks.get(robot.task_id)
        if robot.state == "ASSIGNED":
            set_phase(engine, robot, "MOVING_TO_PICK", (zone.pick_distance_m-robot.distance_m)/c.robot_speed_mps)
        elif robot.state == "MOVING_TO_PICK":
            robot.distance_m = zone.pick_distance_m
            set_phase(engine, robot, "PICKING", engine.pick_duration(task))
        elif robot.state == "PICKING":
            # Completion at the end of this step; phase start is at previous step end.
            engine.predictor.observe_pick(zone.id, engine.now - robot.phase_started_s)
            s.items[task.item_id].location = robot.id
            engine.emit("ITEM_PICKED", item_id=task.item_id, task_id=task.id, robot_id=robot.id)
            set_phase(engine, robot, "CARRYING", zone.pick_distance_m / c.robot_speed_mps)
        elif robot.state == "CARRYING":
            robot.distance_m = 0
            set_phase(engine, robot, "DROPPING", c.drop_s)
        elif robot.state == "DROPPING":
            task.status, task.ready_s, task.completed_s = "READY", engine.now, engine.now
            s.items[task.item_id].location = f"BUFFER:{zone.id}"
            cid = f"C:{task.item_id}"
            s.carriers[cid] = Carrier(cid, task.item_id, task.order_id, zone.id, task.id, position_m=zone.entry_m)
            engine.emit("ITEM_READY", order_id=task.order_id, task_id=task.id, item_id=task.item_id, carrier_id=cid)
            robot.task_id = None
            robot.jobs_since_charge += 1
            if robot.jobs_since_charge >= c.battery_tasks:
                set_phase(engine, robot, "CHARGING", c.charge_s)
            else:
                set_phase(engine, robot, "IDLE", dt)
        elif robot.state == "CHARGING":
            robot.jobs_since_charge = 0
            set_phase(engine, robot, "IDLE", dt)
            engine.replan_reason = "robot_charged"


def ready_estimate(engine, task):
    if task.status == "READY":
        return engine.now
    robot = engine.state.robots[task.robot_id]
    c, zone = engine.config, engine.zones[task.zone_id]
    phase = robot.interrupted_state if robot.state == "FAILED" else robot.state
    pick = quantize(engine.predictor.pick_seconds(zone.id, c), c)
    travel = quantize(zone.pick_distance_m/c.robot_speed_mps, c)
    drop = quantize(c.drop_s, c)
    remaining = robot.remaining_s
    if phase == "PICKING":
        remaining = quantize(max(c.tick_s, pick - (engine.now-robot.phase_started_s)), c)
    tail = {"ASSIGNED": travel + pick + travel + drop, "MOVING_TO_PICK": pick + travel + drop,
            "PICKING": travel + drop, "CARRYING": drop, "DROPPING": 0}[phase]
    recovery = max(0, (robot.failed_until_s or engine.now) - engine.now)
    return engine.now + recovery + remaining + tail

