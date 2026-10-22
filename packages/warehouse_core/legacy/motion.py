"""Metre/second motion shared by navigation and its free-flow ETA.

Grid routes remain polylines. A robot brakes to rest at a change of direction,
turns on the cleared cell centre, then accelerates along the next edge. No curve
is allowed to leave the navigation graph.
"""
from dataclasses import dataclass
from functools import lru_cache
import math


@dataclass(frozen=True)
class MotionConfig:
    max_speed_mps: float = 1.2
    acceleration_mps2: float = .6
    deceleration_mps2: float = .8
    turn_rate_rad_s: float = 1.2

    def __post_init__(self):
        for value in self.__dict__.values():
            if not math.isfinite(value) or value <= 0:
                raise ValueError('Robot motion values must be finite and positive')


def angle_delta(target, current):
    return math.atan2(math.sin(target-current), math.cos(target-current))


def stopping_distance(path, index, x, z):
    """Distance to the next bend or destination, not just the next grid cell."""
    tx, tz = path[index][0]+.5, path[index][1]+.5
    distance = math.hypot(tx-x, tz-z)
    direction = math.atan2(tz-z, tx-x)
    for point in path[index+1:]:
        nx, nz = point[0]+.5, point[1]+.5
        following = math.atan2(nz-tz, nx-tx)
        if abs(angle_delta(following, direction)) > .01:
            break
        distance += math.hypot(nx-tx, nz-tz)
        tx, tz = nx, nz
    return distance


def advance_speed(speed, limit, distance, config, dt):
    # Discrete stopping envelope: leave enough room for the next tick's brake.
    brake = config.deceleration_mps2
    safe = max(0., math.sqrt((brake*dt)**2 + 2*brake*distance)-brake*dt)
    target = min(limit, safe)
    rate = config.acceleration_mps2 if target > speed else brake
    return max(0., speed + max(-rate*dt, min(rate*dt, target-speed)))


@lru_cache(maxsize=4096)
def _run_duration(lengths, speed, limit, config, dt, limits=None):
    """Cache repeated metre-aligned straight runs, retaining tick quantization."""
    remaining = sum(lengths)
    elapsed = 0.
    for index, length in enumerate(lengths):
        distance = length
        while distance > 1e-8:
            speed = advance_speed(speed, limits[index] if limits else limit, remaining, config, dt)
            step = min(distance, speed*dt)
            if remaining < config.deceleration_mps2*dt**2/2 and speed <= config.deceleration_mps2*dt:
                step = distance
            distance -= step
            remaining = max(0., remaining-step)
            elapsed += dt
            if elapsed > 10000:
                return None
    return elapsed


def route_eta(path, index, position, heading, speed, limit, config, dt=.1, limits=None, reverse=False):
    """Free-flow ETA from the same discrete law, including stop/turn/start.

    Runs after the first start at rest and are reusable across robots. Avoid
    simulating an entire future journey on every live ETA refresh.
    """
    x, z = position[0], position[2]
    runs = []
    for i, point in enumerate(path[index:]):
        nx, nz = point[0]+.5, point[1]+.5
        distance = math.hypot(nx-x,nz-z)
        direction = math.atan2(nz-z,nx-x)
        if distance > 1e-8:
            if runs and abs(angle_delta(direction,runs[-1][0])) < .01:
                runs[-1][1].append(distance)
                runs[-1][2].append(limits[i] if limits else limit)
            else:
                runs.append((direction,[distance],[limits[i] if limits else limit]))
        x, z = nx, nz
    elapsed = 0.
    for direction, lengths, speeds in runs:
        if reverse and abs(angle_delta(direction+math.pi,heading)) < abs(angle_delta(direction,heading)):
            direction += math.pi
        angle = abs(angle_delta(direction,heading))
        if angle > 1e-6:
            elapsed += math.ceil((angle-1e-6)/(config.turn_rate_rad_s*dt))*dt
            speed = 0.
        duration = _run_duration(tuple(lengths),speed,limit,config,dt,tuple(speeds))
        if duration is None:
            return None
        elapsed += duration
        heading = direction
        speed = 0.
    return round(elapsed,1)
