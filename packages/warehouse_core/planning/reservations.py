from __future__ import annotations
from dataclasses import dataclass, asdict
import math

from warehouse_core.domain.config import Config


@dataclass
class Reservation:
    task_id: str
    order_id: str
    zone_id: str
    entry_s: float
    exit_s: float
    crossings: dict[str, float]
    committed: bool = False


class ReservationBook:
    def __init__(self, config: Config):
        self.config = config
        self.entries: dict[str, Reservation] = {}

    @property
    def headway_s(self) -> float:
        return (self.config.carrier_length_m + self.config.safe_gap_m) / self.config.belt_speed_mps

    def crossings(self, zone_id: str, entry_s: float) -> dict[str, float]:
        start = next(z.entry_m for z in self.config.zones if z.id == zone_id)
        points = sorted({z.entry_m for z in self.config.zones if z.entry_m >= start} | {self.config.belt_length_m})
        return {f"M{p:g}": entry_s + (p - start) / self.config.belt_speed_mps for p in points}

    def reserve(self, task_id: str, order_id: str, zone_id: str, earliest_s: float,
                has_destination: bool, now: float) -> Reservation | None:
        # No mutation until *every* downstream merge and the destination pass.
        if not has_destination:
            return None
        step = self.config.tick_s
        candidate = math.ceil((max(now, earliest_s) - 1e-9) / step) * step
        limit = now + self.config.reservation_horizon_s
        peers = [r for tid, r in self.entries.items() if tid != task_id]
        while candidate <= limit:
            crossings = self.crossings(zone_id, candidate)
            shift = 0.0
            for peer in peers:
                for point in crossings.keys() & peer.crossings.keys():
                    gap = crossings[point] - peer.crossings[point]
                    if abs(gap) < self.headway_s - 1e-8:
                        shift = max(shift, self.headway_s - gap)
            if shift <= 1e-8:
                result = Reservation(task_id, order_id, zone_id, candidate, max(crossings.values()), crossings)
                self.entries[task_id] = result
                return result
            candidate = math.ceil((candidate + shift - 1e-9) / step) * step
        return None

    def cancel(self, task_id: str) -> None:
        self.entries.pop(task_id, None)

    def dump(self) -> list[dict]:
        return [asdict(r) for r in sorted(self.entries.values(), key=lambda r: (r.entry_s, r.task_id))]

