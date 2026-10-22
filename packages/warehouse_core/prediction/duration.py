from __future__ import annotations
from dataclasses import dataclass, field
from typing import Protocol
import math

from warehouse_core.domain.config import Config


class DurationPredictor(Protocol):
    def pick_seconds(self, zone_id: str, config: Config) -> float: ...
    def observe_pick(self, zone_id: str, elapsed_s: float) -> None: ...


@dataclass
class PhysicalPredictor:
    def pick_seconds(self, zone_id: str, config: Config) -> float:
        return config.pick_s

    def observe_pick(self, zone_id: str, elapsed_s: float) -> None:
        pass


@dataclass
class HistoricalPredictor(PhysicalPredictor):
    # Updated only on completed observed picks. No future scenario or hidden duration input.
    samples: dict[str, tuple[float, int]] = field(default_factory=dict)

    def pick_seconds(self, zone_id: str, config: Config) -> float:
        total, n = self.samples.get(zone_id, (0.0, 0))
        return (total + 3 * config.pick_s) / (n + 3)

    def observe_pick(self, zone_id: str, elapsed_s: float) -> None:
        total, n = self.samples.get(zone_id, (0.0, 0))
        self.samples[zone_id] = (total + elapsed_s, n + 1)


def quantize(seconds: float, config: Config) -> float:
    return max(config.tick_s, math.ceil((seconds - 1e-9) / config.tick_s) * config.tick_s)

