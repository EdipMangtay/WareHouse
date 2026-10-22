from __future__ import annotations
from dataclasses import dataclass
from pathlib import Path
import hashlib
import json
import math
import random

from warehouse_core.domain.config import Config


def stream_seed(seed: int, stream: str) -> int:
    return int.from_bytes(hashlib.sha256(f"{seed}:{stream}".encode()).digest()[:8], "big")


@dataclass(frozen=True)
class Scenario:
    name: str
    config: Config
    orders: tuple[dict, ...]
    incidents: tuple[dict, ...]
    horizon_s: float
    scenario_seed: int
    stream_seeds: dict[str, int]

    def manifest(self) -> dict:
        return dict(name=self.name, config=self.config.to_dict(), orders=self.orders,
                    incidents=self.incidents, horizon_s=self.horizon_s,
                    scenario_seed=self.scenario_seed, stream_seeds=self.stream_seeds)


def load_scenario(source: str | Path | dict, seed: int = 42) -> Scenario:
    data = json.loads(Path(source).read_text()) if not isinstance(source, dict) else source
    config = Config.from_dict(data.get("config", {}))
    seeds = {name: stream_seed(seed, name) for name in ("orders", "disruptions", "preparation")}
    rng = random.Random(seeds["orders"])
    zones = [z.id for z in config.zones]
    orders = data.get("orders")
    if orders is None:
        generation = data.get("demand", {})
        count = int(generation.get("count", 12))
        if not 1 <= count <= 10000:
            raise ValueError("demand count must be 1..10000")
        weights = generation.get("zone_weights", [1] * len(zones))
        orders = []
        for i in range(count):
            n = rng.randint(int(generation.get("min_items", 1)), int(generation.get("max_items", 4)))
            selected = (rng.sample(zones, min(n, len(zones))) if generation.get("distinct_zones")
                        else rng.choices(zones, weights=weights, k=n))
            at = round(i * float(generation.get("interval_s", 4)), 6)
            orders.append(dict(id=f"O{i + 1:04d}", arrival_s=at,
                               due_s=at + float(generation.get("due_after_s", 120)), zones=selected))
    ids = set()
    normalized = []
    for order in orders:
        oid = str(order["id"])
        at = float(order.get("arrival_s", 0))
        due = float(order.get("due_s", at + 120))
        components = list(order["zones"])
        if oid in ids or not oid or not math.isfinite(at) or at < 0 or not math.isfinite(due) or due < at:
            raise ValueError("invalid/duplicate order identity or times")
        if not components or len(components) > config.consolidation_slots or any(z not in zones for z in components):
            raise ValueError("order components must fit consolidation and reference existing zones")
        ids.add(oid)
        normalized.append(dict(id=oid, arrival_s=at, due_s=due, zones=components))
    disruptions = random.Random(seeds["disruptions"])
    incidents = []
    robot_ids = {f"{z.id}-R{i+1}" for z in config.zones for i in range(z.robots)}
    for incident in data.get("incidents", []):
        event = dict(incident)
        event["at_s"] = float(event["at_s"]) + disruptions.uniform(0, float(event.pop("jitter_s", 0)))
        duration = float(event["duration_s"])
        if not math.isfinite(event["at_s"]) or event["at_s"] < 0 or not math.isfinite(duration) or duration <= 0:
            raise ValueError("incident times must be finite, nonnegative; duration positive")
        kind = event["kind"]
        if kind not in {"ROBOT_FAILURE", "BELT_STOP", "PACKING_FAILURE"}:
            raise ValueError("unknown incident kind")
        if kind == "ROBOT_FAILURE" and event.get("target") not in robot_ids:
            raise ValueError("unknown robot")
        if kind == "PACKING_FAILURE" and event.get("target") not in {f"P{i+1}" for i in range(config.packing_stations)}:
            raise ValueError("unknown packing station")
        incidents.append(event)
    horizon = float(data.get("horizon_s", 900))
    if not math.isfinite(horizon) or horizon <= 0:
        raise ValueError("horizon_s must be positive")
    return Scenario(data.get("name", "custom"), config,
                    tuple(sorted(normalized, key=lambda o: (o["arrival_s"], o["id"]))),
                    tuple(sorted(incidents, key=lambda e: e["at_s"])), horizon, seed, seeds)

