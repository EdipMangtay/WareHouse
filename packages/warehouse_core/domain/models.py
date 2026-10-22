from __future__ import annotations
from dataclasses import dataclass, field


@dataclass
class Item:
    id: str
    sku: str
    order_id: str
    zone_id: str
    location: str = "SHELF"


@dataclass
class Order:
    id: str
    arrival_s: float
    due_s: float
    item_ids: list[str]
    status: str = "WAITING_ADMISSION"
    admitted_s: float | None = None
    packing_started_s: float | None = None
    completed_s: float | None = None


@dataclass
class PickTask:
    id: str
    order_id: str
    item_id: str
    zone_id: str
    status: str = "QUEUED"
    robot_id: str | None = None
    started_s: float | None = None
    ready_s: float | None = None
    completed_s: float | None = None


@dataclass
class Robot:
    id: str
    zone_id: str
    lane: int
    state: str = "IDLE"
    task_id: str | None = None
    distance_m: float = 0.0
    remaining_s: float = 0.0
    phase_started_s: float = 0.0
    jobs_since_charge: int = 0
    failed_until_s: float | None = None
    interrupted_state: str | None = None


@dataclass
class Carrier:
    id: str
    item_id: str
    order_id: str
    zone_id: str
    task_id: str
    state: str = "LOCAL_BUFFER"
    position_m: float = 0.0
    entered_s: float | None = None
    arrived_s: float | None = None


@dataclass
class CustomerPackage:
    id: str
    order_id: str
    item_ids: list[str]
    completed_s: float


@dataclass
class PackingStation:
    id: str
    order_id: str | None = None
    remaining_s: float = 0.0
    failed_until_s: float | None = None


@dataclass
class State:
    tick: int = 0
    orders: dict[str, Order] = field(default_factory=dict)
    items: dict[str, Item] = field(default_factory=dict)
    tasks: dict[str, PickTask] = field(default_factory=dict)
    robots: dict[str, Robot] = field(default_factory=dict)
    carriers: dict[str, Carrier] = field(default_factory=dict)
    packages: dict[str, CustomerPackage] = field(default_factory=dict)
    packing: dict[str, PackingStation] = field(default_factory=dict)
    # One slot per unit item/carrier, reserved for ALL components until packing ends.
    consolidation: dict[str, int] = field(default_factory=dict)
    belt_stopped_until_s: float | None = None

