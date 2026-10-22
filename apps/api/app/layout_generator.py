"""Deterministic, metre-aligned warehouse presets with verifiable robot access.

Each rack is one navigation location. Individual storage addresses live separately
in storage_slots, so slot capacity does not inflate the engine's task graph.
"""
from __future__ import annotations

import hashlib
from collections import deque
from dataclasses import asdict, dataclass, replace
from math import hypot, floor
from typing import Any

from .sim.navgrid import build_nav_grid


@dataclass(frozen=True)
class LayoutConfig:
    preset: str = "large"
    width: int = 180
    depth: int = 120
    height: int = 14
    cell_size: int = 1
    corridor: int = 4
    main_corridor: int = 8
    rack_width: int = 4
    rack_depth: int = 2
    rack_height: int = 8
    rack_levels: int = 5
    bays_per_level: int = 4
    packing_stations: int = 5
    sorting_stations: int = 5
    robot_count: int = 48
    robot_radius: float = .65
    clearance_padding: int = 1

    conveyor_speed: float = 1.2
    parcel_pitch: float = 1.4
    parcel_gap: float = .35
    unloading_capacity: int = 400
    zone_split_x: int = 0
    zone_split_z: int = 0
    seed: int = 42

    def validate(self) -> None:
        if not .1 <= self.conveyor_speed <= 3 or self.parcel_pitch < max(1.2,.9+self.parcel_gap) or self.parcel_gap < .2 or self.unloading_capacity < 1:
            raise ValueError("Unsafe conveyor speed, spacing or exit capacity")
        for name in ("width", "depth", "height", "cell_size", "corridor", "main_corridor", "rack_width", "rack_depth", "rack_height", "rack_levels", "bays_per_level", "robot_count", "clearance_padding", "packing_stations", "sorting_stations"):
            if type(getattr(self, name)) is not int:
                raise ValueError(f"{name} must be an integer")
        if not (80 <= self.width <= 300 and 60 <= self.depth <= 200):
            raise ValueError("Warehouse dimensions must be within 80–300 × 60–200 m")
        if self.width % 2 or self.depth % 2 or self.main_corridor % 2:
            raise ValueError("Width, depth and main corridor must use even metre dimensions")
        if self.cell_size != 1 or self.clearance_padding != 1:
            raise ValueError("Generated layouts require 1 m cells and one-cell collision clearance")
        if not (.5 <= self.robot_radius <= .85):
            raise ValueError("Robot radius must be between 0.5 and 0.85 m")
        if self.corridor < 4 or self.main_corridor < self.corridor:
            raise ValueError("Secondary corridors need at least 4 m; main corridor cannot be narrower")
        if self.main_corridor > self.width - 68:
            raise ValueError("Main corridor leaves insufficient space for processing stations")
        if self.rack_width < 3 or self.rack_depth < 2 or self.rack_height < 8 or self.height < self.rack_height + 2:
            raise ValueError("Racks require ≥3 × 2 × 8 m and at least 2 m roof clearance")
        if self.rack_levels not in (4, 5) or not 1 <= self.bays_per_level <= self.rack_width:
            raise ValueError("Use 4 or 5 rack levels and at least one metre per bay")
        if not 1 <= self.robot_count <= (self.width - 12) // 3:
            raise ValueError("Robot count exceeds separated rear-apron spawn capacity")
        center=self.zone_split_x or self.width//2
        if type(center) is not int or not 35<=center<=self.width-35:
            raise ValueError('Invalid east/west sector boundary')
        available = min(center,self.width-center)-self.main_corridor//2 - 8
        for count in (self.packing_stations, self.sorting_stations):
            if count < 1 or count * 12 + (count-1)*4 > available:
                raise ValueError("Processing station count does not fit with four-metre separation")
        if self.rack_width > (self.width - self.main_corridor) // 2 - 8 or self.rack_depth > self.depth - 40:
            raise ValueError("Rack dimensions do not fit storage blocks")
        if not self.preset or any(ch not in "abcdefghijklmnopqrstuvwxyz0123456789_-" for ch in self.preset):
            raise ValueError("Preset name must be a safe lowercase identifier")


PRESETS: dict[str, LayoutConfig] = {
    "small": LayoutConfig(preset="small", width=80, depth=60, robot_count=12, packing_stations=2, sorting_stations=2),
    "medium": LayoutConfig(preset="medium", width=120, depth=80, robot_count=20, packing_stations=3, sorting_stations=3),
    "large": LayoutConfig(),
    "mega": LayoutConfig(preset="mega", width=240, depth=160, robot_count=48, packing_stations=7, sorting_stations=7),
}


def preset_config(name: str, **overrides: Any) -> LayoutConfig:
    if name not in PRESETS:
        raise ValueError(f"Unknown preset {name!r}; choose {', '.join(PRESETS)}")
    return replace(PRESETS[name], **overrides)


def polygon(rect: list[float]) -> list[list[float]]:
    x0, z0, x1, z1 = rect
    return [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]


def generate_layout(config: LayoutConfig | str = "large", *, validate: bool = True) -> dict[str, Any]:
    cfg = preset_config(config) if isinstance(config, str) else config
    cfg.validate()
    w, d = cfg.width, cfg.depth
    center = cfg.zone_split_x or w//2
    left_end, right_start = center-cfg.main_corridor//2, center+cfg.main_corridor//2
    zones = [
        ("A", "Mal Kabul", [3, 2, left_end, 14], "#d6a44b"),
        ("B", "Ana Depolama", [3, 15, left_end, d - 21], "#5a9dbb"),
        ("C", "Robot Toplama", [right_start, 15, w - 3, d - 21], "#65ad9d"),
        ("D", "Ayrıştırma", [3, d - 19, left_end, d - 12], "#9c8bc0"),
        ("E", "Paketleme", [right_start, d - 19, w - 3, d - 12], "#d2a66c"),
        ("F", "Sevkiyat", [right_start, 2, w - 3, 14], "#5dafbd"),
        ("G", "Şarj ve Bakım", [3, d - 11, w - 3, d - 2], "#7ea597"),
    ]
    result: dict[str, Any] = dict(
        schema_version="1.0", id=f"waretwin-{cfg.preset}-v2", name=f"WareTwin {cfg.preset.title()} · {w} × {d} m", units="m",
        size=dict(width=w, depth=d, height=cfg.height), grid=dict(cell_size=1, cols=w, rows=d),
        floors=[dict(id=1, name="Zemin Kat", elevation=0)], columns=[], lifts=[],
        navigation=dict(robot_radius=cfg.robot_radius, clearance_padding=cfg.clearance_padding, minimum_corridor=cfg.corridor, safety_margin=0, corridors=[
            dict(id="MAIN-SPINE",floor=1,rect=[left_end,2,right_start,d-2],mode="two_way"),
            dict(id="FRONT-CROSS",floor=1,rect=[2,13,w-2,16],mode="two_way"),
            dict(id="REAR-CROSS",floor=1,rect=[2,d-12,w-2,d-8],mode="two_way"),
        ]),
        zones=[dict(id=i, name=name, polygon=polygon(rect), color=color, floor=1) for i, name, rect, color in zones],
        docks=[], racks=[], conveyors=[], stations=[], charging_stations=[], parking=[], restricted_areas=[],
        walkways=[], cameras=[], sensors=[], locations=[], obstacles=[], spawn=dict(robots=[]), storage_slots=[],
    )

    def location(ident: str, kind: str, zone: str, point: list[float], rack: str | None = None) -> None:
        result["locations"].append(dict(id=ident, kind=kind, zone=zone, floor=1, rack_id=rack,
                                        level_range=[1, cfg.rack_levels] if rack else None, access_point=point))

    # Keep familiar SHELF-A01… identifiers stable across all sizes and for seeded products.
    rack_number = 0
    for zone, x0, x1 in (("B", 4, left_end - 4), ("C", right_start + 4, w - 4)):
        for z in range(18, d - 22 - cfg.rack_depth + 1, cfg.rack_depth + cfg.corridor):
            for x in range(x0, x1 - cfg.rack_width + 1, cfg.rack_width + cfg.corridor):
                rack_number += 1
                rid, lid = f"RACK-A{rack_number:03d}", f"SHELF-A{rack_number:02d}"
                result["racks"].append(dict(id=rid, zone=zone, floor=1, position=[x, 0, z],
                    size=[cfg.rack_width, cfg.rack_height, cfg.rack_depth], rotation=0, levels=cfg.rack_levels, model="rack_double", blocks_grid=True))
                location(lid, "SHELF", zone, [x + cfg.rack_width // 2 + .5, z - 1.5], rid)
                for level in range(1, cfg.rack_levels + 1):
                    for bay in range(1, cfg.bays_per_level + 1):
                        for side in ("front", "back"):
                            result["storage_slots"].append(dict(id=f"{rid}-L{level:02d}-B{bay:02d}-{side[0].upper()}",
                                rack_id=rid, location_id=lid, level=level, bay=bay, side=side))

    # Processing solids sit behind rack blocks with a four-metre transfer corridor.
    for kind, prefix, zone, count, start in (("SORTING", "SORT", "D", cfg.sorting_stations, 4), ("PACKING", "PACK", "E", cfg.packing_stations, right_start + 4)):
        for index in range(count):
            x = start + index * 16
            sid = f"{prefix}-{index+1:02d}"
            rect = [x, d - 18, x + 12, d - 14]
            point = [x + 6.5, d - 12.5]
            result["stations"].append(dict(id=sid, kind=kind, zone=zone, rect=rect, access_point=point))
            location(sid, kind, zone, point)
    # Physical inspection/maintenance benches: their rectangles also block navigation.
    for sid, kind, zone, rect, point in (
        ("RECEIVE-01", "QUALITY", "A", [3, 4, 7, 7], [8.5, 5.5]),
        ("MAINT-01", "MAINTENANCE", "G", [w-17, d-7, w-5, d-3], [w-11.5, d-8.5]),
    ):
        result["stations"].append(dict(id=sid, kind=kind, zone=zone, rect=rect, access_point=point))
        location(sid, kind, zone, point)

    for kind, prefix, zone, xs in (("INBOUND", "IN", "A", (12, left_end - 10)), ("OUTBOUND", "OUT", "F", (right_start + 10, w - 12))):
        for i, x in enumerate(xs, 1):
            result["docks"].append(dict(id=f"{kind}-{i}", kind=kind, zone=zone, rect=[x - 4, 2, x + 4, 8], door=[x, 0]))
            location(f"{prefix}-{i:02d}", kind, zone, [x + .5, 5.5])
    # Belt endpoints stay inside their blocked centreline-width envelope; no route crosses a belt.
    for i, (zone, ax, bx) in enumerate((("A", 10, left_end - 8), ("F", right_start + 8, w - 10)), 1):
        result["conveyors"].append(dict(id=f"CV{i:02d}", name=f"Aktarma Hattı {i}", zone=zone,
            path=[[ax, 11], [bx, 11]], width=2, speed_mps=.5, direction="FORWARD", blocks_grid=True))

    chargers = min(12, max(4, (cfg.robot_count + 3) // 4))
    for i in range(chargers):
        x, z = 6.5 + i * 4, d - 3.5
        ident, point = f"CHG-{i + 1:02d}", [x, d - 6.5]
        result["charging_stations"].append(dict(id=ident, zone="G", position=[x, 0, z], heading=0, power_kw=22, access_point=point))
        location(ident, "CHARGING", "G", point)
    result["parking"] = [dict(id="PARK-01", zone="G", rect=[4, d - 11, w - 4, d - 7], slots=cfg.robot_count)]
    for i in range(cfg.robot_count):
        result["spawn"]["robots"].append(dict(id=f"R{i + 1:02d}", position=[6.5 + i * 3, 0, d - 9.5], heading=-1.5707963267948966,
                                            battery=90 + i % 10, floor=1))

    for i, (zone, _, rect, _) in enumerate(zones, 1):
        x0, z0, x1, z1 = rect
        result["cameras"].append(dict(id=f"CAM-{i:02d}", zone=zone, floor=1, position=[x0 + 1, 10, z0 + 1],
                                       look_at=[(x0 + x1) / 2, 0, (z0 + z1) / 2], fov_deg=70, range_m=max(x1 - x0, z1 - z0)))
        result["sensors"].append(dict(id=f"SNS-{i:02d}", kind="LIDAR", zone=zone, position=[x0 + 1, 3, z0 + 1]))

    result["walkways"] = [dict(id="WALK-01", polygon=polygon([left_end, 2, right_start, d - 12]), robots_allowed=True, speed_limit_mps=1.5)]
    # Explicit boundary solids match the building perimeter. The nav builder adds body clearance.
    result["obstacles"] = [dict(id=f"WALL-{i}", kind="WALL", rect=rect) for i, rect in enumerate(
        ([0, 0, w, 1], [0, d - 1, w, d], [0, 1, 1, d - 1], [w - 1, 1, w, d - 1]), 1)]
    for z in range(24, d-22, 24):
        result["obstacles"].append(dict(id=f"COLUMN-{z}", kind="PILLAR", rect=[w//2-1, z, w//2+1, z+1]))
    result["metadata"] = dict(preset=cfg.preset, generator_version="2.0", config=asdict(cfg),
        counts=dict(racks=len(result["racks"]), storage_slots=len(result["storage_slots"]), robots=cfg.robot_count,
                    packing_stations=cfg.packing_stations, sorting_stations=cfg.sorting_stations, zones=7, floor_area_m2=w * d))
    from .conveyor_layout import add_network
    add_network(result, cfg)
    if validate:
        result["metadata"]["validation"] = validate_layout(result)
    return result


def solid_rectangles(layout: dict[str, Any]) -> list[tuple[str, list[float]]]:
    out = [(r["id"], [r["position"][0], r["position"][2], r["position"][0] + r["size"][0], r["position"][2] + r["size"][2]]) for r in layout["racks"]]
    out += [(s["id"], s["rect"]) for s in layout["stations"]]
    out += [(o["id"], o["rect"]) for o in layout.get("obstacles", [])]
    for c in layout["charging_stations"]:
        x, _, z = c["position"]
        out.append((c["id"], [x - .45, z - .4, x + .45, z + .5]))
    for c in layout["conveyors"]:
        for i, (a, b) in enumerate(zip(c["path"], c["path"][1:])):
            hw = c["width"] / 2
            out.append((f"{c['id']}:{i}", [min(a[0], b[0]) - hw, min(a[1], b[1]) - hw, max(a[0], b[0]) + hw, max(a[1], b[1]) + hw]))
    return out


def validate_layout(layout: dict[str, Any]) -> dict[str, Any]:
    """Fail before writing an unusable warehouse; validate the actual shared grid."""
    w, d = layout["size"]["width"], layout["size"]["depth"]
    if layout["grid"] != dict(cell_size=1, cols=w, rows=d):
        raise ValueError("Layout and navigation dimensions disagree")
    if not {"ZONE_A", "ZONE_B", "ZONE_C", "ZONE_D"} <= {z["id"] for z in layout["zones"]}:
        raise ValueError("Generated warehouse needs four storage sectors")
    from .conveyor_layout import validate_network
    validate_network(layout)
    conveyor_by_id = {c["id"]: c for c in layout["conveyors"]}
    solids = solid_rectangles(layout)
    for name, rect in solids:
        conveyor = conveyor_by_id.get(name.split(':')[0])
        if conveyor and conveyor.get('placement') == 'exterior':
            bounds = layout['conveyor_network']['apron_bounds']
            if not (bounds[0] <= rect[0] < rect[2] <= bounds[2] and bounds[1] <= rect[1] < rect[3] <= bounds[3]):
                raise ValueError(f'Conveyor outside apron bounds: {name}')
            if not (rect[2] <= 0 or rect[0] >= w or rect[3] <= 0 or rect[1] >= d):
                raise ValueError(f'Exterior conveyor enters warehouse: {name}')
            continue
        if not (0 <= rect[0] < rect[2] <= w and 0 <= rect[1] < rect[3] <= d):
            raise ValueError(f"Solid outside warehouse bounds: {name}")
    for i, (name, a) in enumerate(solids):
        for other, b in solids[i + 1:]:
            if max(a[0], b[0]) < min(a[2], b[2]) and max(a[1], b[1]) < min(a[3], b[3]):
                ca, cb = conveyor_by_id.get(name.split(':')[0]), conveyor_by_id.get(other.split(':')[0])
                if ca and cb and (ca['path'][-1] == cb['path'][0] or cb['path'][-1] == ca['path'][0] or ca['path'][-1] == cb['path'][-1] or ca['path'][0] == cb['path'][0]):
                    continue  # Registered roller merge / diverter junction footprint.
                raise ValueError(f"Physical solids overlap: {name} and {other}")

    racks = [(name, rect) for name, rect in solids if name.startswith("RACK-")]
    corridor = layout["navigation"]["minimum_corridor"]
    for i, (name, a) in enumerate(racks):
        if any(int(n) != n for n in a):
            raise ValueError(f"Rack is not metre-aligned: {name}")
        for other, b in racks[i + 1:]:
            if max(a[0], b[0]) < min(a[2], b[2]):
                gap = max(a[1], b[1]) - min(a[3], b[3])
            elif max(a[1], b[1]) < min(a[3], b[3]):
                gap = max(a[0], b[0]) - min(a[2], b[2])
            else:
                continue
            if gap < corridor:
                raise ValueError(f"Rack aisle below {corridor} m: {name}, {other}")

    ids = [loc["id"] for loc in layout["locations"]]
    if len(ids) != len(set(ids)):
        raise ValueError("Duplicate location identifiers")
    rack_ids = {r["id"] for r in layout["racks"]}
    slot_ids = set()
    for slot in layout["storage_slots"]:
        if slot["id"] in slot_ids or slot["rack_id"] not in rack_ids or slot["location_id"] not in ids:
            raise ValueError("Storage slot address is duplicated or dangling")
        slot_ids.add(slot["id"])
    if len(slot_ids) != layout["metadata"]["counts"]["storage_slots"]:
        raise ValueError("Storage slot count does not match metadata")

    grid = build_nav_grid(layout)
    points = [(l["id"], l["access_point"]) for l in layout["locations"]]
    points += [(r["id"], [r["position"][0], r["position"][2]]) for r in layout["spawn"]["robots"]]
    radius = layout["navigation"]["robot_radius"]
    for name, (x, z) in points:
        col, row = floor(x), floor(z)
        if not (0 <= col < grid.cols and 0 <= row < grid.rows) or grid.cells[row * grid.cols + col] == 1:
            raise ValueError(f"Required access point is blocked: {name} ({x},{z})")
        for solid, (x0, z0, x1, z1) in solids:
            distance = hypot(max(x0 - x, 0, x - x1), max(z0 - z, 0, z - z1))
            if distance < radius + .15:
                raise ValueError(f"Insufficient robot body clearance at {name} near {solid}")
    if not points:
        raise ValueError("Warehouse has no operational access points")
    start = (floor(points[0][1][0]), floor(points[0][1][1]))
    reached = {start}
    pending = deque([start])
    while pending:
        x, z = pending.popleft()
        for nx, nz in ((x - 1, z), (x + 1, z), (x, z - 1), (x, z + 1)):
            if 0 <= nx < grid.cols and 0 <= nz < grid.rows and (nx, nz) not in reached and grid.cells[nz * grid.cols + nx] != 1:
                reached.add((nx, nz)); pending.append((nx, nz))
    for name, (x, z) in points:
        if (floor(x), floor(z)) not in reached:
            raise ValueError(f"Required access point is disconnected: {name}")
    free_cells = sum(c != 1 for c in grid.cells)
    if len(reached) != free_cells:
        raise ValueError(f"Navigation has {free_cells - len(reached)} isolated free cells")
    return dict(navigation_sha256=hashlib.sha256(bytes(grid.cells)).hexdigest(), connected=True, reachable_cells=len(reached), validated_access_points=len(points),
                physical_solids=len(solids), minimum_rack_corridor_m=corridor, robot_radius_m=radius)
