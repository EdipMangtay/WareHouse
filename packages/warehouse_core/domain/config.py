from __future__ import annotations

from dataclasses import dataclass, field, asdict
import math


@dataclass(frozen=True)
class ZoneConfig:
    id: str
    entry_m: float
    robots: int = 2
    buffer_slots: int = 4
    pick_distance_m: float = 6.0


@dataclass(frozen=True)
class Config:
    tick_s: float = 0.5
    zones: tuple[ZoneConfig, ...] = field(default_factory=lambda: tuple(
        ZoneConfig(f"Z{i + 1}", i * 12.0) for i in range(4)))
    robot_speed_mps: float = 1.5
    pick_s: float = 3.0
    drop_s: float = 1.0
    preparation_cv: float = 0.0
    belt_length_m: float = 48.0
    belt_speed_mps: float = 1.0
    carrier_length_m: float = 0.8
    safe_gap_m: float = 0.6
    consolidation_slots: int = 16
    packing_stations: int = 2
    packing_s: float = 8.0
    packing_per_item_s: float = 1.0
    commitment_s: float = 2.0
    replan_s: float = 15.0
    reservation_horizon_s: float = 1200.0
    battery_tasks: int = 20
    charge_s: float = 20.0

    def __post_init__(self):
        positive = ("tick_s", "robot_speed_mps", "pick_s", "drop_s", "belt_length_m",
                    "belt_speed_mps", "carrier_length_m", "safe_gap_m", "packing_s",
                    "replan_s", "reservation_horizon_s", "charge_s")
        for name in positive:
            value = getattr(self, name)
            if not math.isfinite(value) or value <= 0:
                raise ValueError(f"{name} must be finite and positive")
        for name in ("consolidation_slots", "packing_stations", "battery_tasks"):
            if type(getattr(self, name)) is not int or getattr(self, name) < 1:
                raise ValueError(f"{name} must be a positive integer")
        for name in ("preparation_cv", "packing_per_item_s", "commitment_s"):
            if not math.isfinite(getattr(self, name)) or getattr(self, name) < 0:
                raise ValueError(f"{name} must be finite and nonnegative")
        if not self.zones or len({z.id for z in self.zones}) != len(self.zones):
            raise ValueError("zones must have unique IDs")
        for z in self.zones:
            if not z.id or not math.isfinite(z.entry_m) or not 0 <= z.entry_m < self.belt_length_m:
                raise ValueError("zone entry must lie on belt")
            if type(z.robots) is not int or type(z.buffer_slots) is not int or min(z.robots, z.buffer_slots) < 1:
                raise ValueError("zone robots/buffer_slots must be positive integers")
            if not math.isfinite(z.pick_distance_m) or z.pick_distance_m <= 0:
                raise ValueError("pick distance must be positive")

    @classmethod
    def from_dict(cls, data: dict) -> Config:
        data = dict(data)
        if "zones" in data:
            data["zones"] = tuple(ZoneConfig(**z) for z in data["zones"])
        return cls(**data)

    def to_dict(self) -> dict:
        return asdict(self)

