"""由 warehouse_layout.json 產生導航網格 — frontend/src/layout/navgrid.ts 的 Python 版本。規則必須與前端完全一致。"""
from __future__ import annotations

import json
import hashlib
import math
import os
from pathlib import Path
from typing import Any

from .astar import NavGrid


def load_layout(path: str | Path | None = None) -> dict[str, Any]:
    if path:
        p = Path(path)
    else:
        preset = os.environ.get("TWIN_LAYOUT_PRESET", "large").lower()
        if preset not in {"small", "medium", "large", "mega", "legacy"}:
            raise ValueError("TWIN_LAYOUT_PRESET must be small, medium, large, mega or legacy")
        root = Path(__file__).resolve().parents[3]
        p = (Path(__file__).resolve().parent.parent / "warehouse_layout.json") if preset == "legacy" else root / "shared" / "layouts" / f"{preset}.json"
    with open(p, encoding="utf-8") as f:
        data = json.load(f)
    from .spatial import compile_navigation
    data['navigation_graph'] = compile_navigation(data)
    if not data['navigation_graph']['validation']['valid']:
        report = data['navigation_graph']['validation']
        raise ValueError(f"Invalid warehouse navigation: {report}")
    # Content fingerprint prevents stale frontend geometry accepting another warehouse's robot state.
    spatial = {key: value for key, value in data.items() if key not in {"storage_slots", "revision"}}
    data["revision"] = hashlib.sha256(json.dumps(spatial, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()
    return data


def build_nav_grid(layout: dict[str, Any], floor: int = 1) -> NavGrid:
    graph = layout.get('navigation_graph')
    if graph and str(floor) in graph['floors']:
        data = graph['floors'][str(floor)]
        return NavGrid(data['cols'],data['rows'],bytearray(data['cells']),graph['cell_size'],bytearray(data['outgoing']))
    from .spatial import apply_corridors
    grid = _rasterize_grid(layout,floor)
    _apply_clearance(layout, grid)
    return apply_corridors(layout, grid, floor)


def _rasterize_grid(layout: dict[str, Any], floor: int = 1) -> NavGrid:
    cols, rows, cs = layout["grid"]["cols"], layout["grid"]["rows"], layout["grid"]["cell_size"]
    cells = bytearray(cols * rows)

    def block_lifts() -> None:
        # 電梯井道（鋼架＋護網）在每個樓層都是實體障礙：一般路徑必須繞過，
        # 進出轎廂只走電梯狀態機的 micro-move（不經網格）。
        # round-9g：井道 3D 外觀是 W 2.8 × D 3.6，x 封 ±1.4（3 格）夠用，z 若也只封 ±1.4
        # 會讓南北護網各突出 0.4 m 到可走格，貼著走的機器人會插進護網與角柱；
        # 故 z 封 ±1.9（5 格）。排隊格、門軸中繼格與出口候選點都在範圍外（規則與 TS 相同）。
        for l in layout.get("lifts", []):
            x = l["cell"][0] + 0.5; z = l["cell"][1] + 0.5
            c0 = max(0, math.floor((x - 1.4) / cs)); c1 = min(cols - 1, math.ceil((x + 1.4) / cs) - 1)
            r0 = max(0, math.floor((z - 1.9) / cs)); r1 = min(rows - 1, math.ceil((z + 1.9) / cs) - 1)
            for r in range(r0, r1 + 1):
                base = r * cols
                for c in range(c0, c1 + 1):
                    cells[base + c] = 1

    if floor != 1:
        # 二樓（夾層）：footprint 之外全是障礙；footprint 內可走，再扣掉該樓層貨架（規則與 TS 相同）
        for i in range(len(cells)):
            cells[i] = 1
        fp = next((f.get("footprint") for f in layout.get("floors", []) if f["id"] == floor), None)
        if fp:
            xs = [p[0] for p in fp]; zs = [p[1] for p in fp]
            c0 = max(0, math.floor(min(xs) / cs)); c1 = min(cols - 1, math.ceil(max(xs) / cs) - 1)
            r0 = max(0, math.floor(min(zs) / cs)); r1 = min(rows - 1, math.ceil(max(zs) / cs) - 1)
            for r in range(r0, r1 + 1):
                base = r * cols
                for c in range(c0, c1 + 1):
                    cells[base + c] = 0
        for rk in layout["racks"]:
            if rk["blocks_grid"] and rk.get("floor", 1) == floor:
                x, _, z = rk["position"]; w, _, d = rk["size"]
                c0 = max(0, math.floor(x / cs)); c1 = min(cols - 1, math.ceil((x + w) / cs) - 1)
                r0 = max(0, math.floor(z / cs)); r1 = min(rows - 1, math.ceil((z + d) / cs) - 1)
                for r in range(r0, r1 + 1):
                    base = r * cols
                    for c in range(c0, c1 + 1):
                        cells[base + c] = 1
        block_lifts()
        return NavGrid(cols=cols, rows=rows, cells=cells)

    def fill_rect(x0: float, z0: float, x1: float, z1: float, v: int) -> None:
        c0 = max(0, math.floor(x0 / cs)); c1 = min(cols - 1, math.ceil(x1 / cs) - 1)
        r0 = max(0, math.floor(z0 / cs)); r1 = min(rows - 1, math.ceil(z1 / cs) - 1)
        for r in range(r0, r1 + 1):
            base = r * cols
            for c in range(c0, c1 + 1):
                cells[base + c] = v

    for w in layout["walkways"]:
        xs = [p[0] for p in w["polygon"]]; zs = [p[1] for p in w["polygon"]]
        fill_rect(min(xs), min(zs), max(xs), max(zs), 2 if w.get("robots_allowed",True) else 1)
    for r in layout["racks"]:
        if r["blocks_grid"] and r.get("floor", 1) == 1:
            x, _, z = r["position"]; w, _, d = r["size"]
            fill_rect(x, z, x + w, z + d, 1)
    for c in layout["conveyors"]:
        if c["blocks_grid"]:
            for i in range(len(c["path"]) - 1):
                (ax, az), (bx, bz) = c["path"][i], c["path"][i + 1]
                hw = c["width"] / 2
                fill_rect(min(ax, bx) - hw, min(az, bz) - hw, max(ax, bx) + hw, max(az, bz) + hw, 1)
    for ra in layout["restricted_areas"]:
        if not ra["robots_allowed"]:
            fill_rect(*ra["rect"], 1)
    for s in layout["stations"]:
        fill_rect(*s["rect"], 1)
    # 夾層支撐柱（立在 F1 地面、撐到樓板）：以柱底板 0.9×0.9 m 封成障礙 —— 路徑必須繞柱，不能穿過
    for cx, cz in layout.get("columns", []):
        fill_rect(cx - 0.45, cz - 0.45, cx + 0.45, cz + 0.45, 1)
    # 建築結構柱等實體障礙（round-9d）：整塊封鎖 —— 原本只在 3D 場景程序生成，網格不知道，機器人會穿柱
    for o in layout.get("obstacles", []):
        fill_rect(o["rect"][0], o["rect"][1], o["rect"][2], o["rect"][3], 1)
    # 充電樁櫃體（round-9e）：櫃體是實體 —— 封格後通行走廊固定在停車排南側一格，不會有人從櫃體穿過
    for c in layout["charging_stations"]:
        fill_rect(c["position"][0] - 0.45, c["position"][2] - 0.4, c["position"][0] + 0.45, c["position"][2] + 0.5, 1)
    block_lifts()
    return NavGrid(cols=cols, rows=rows, cells=cells)


def _apply_clearance(layout: dict, grid: NavGrid) -> None:
    cols, rows, cells = grid.cols, grid.rows, grid.cells
    cs = layout["grid"]["cell_size"]
    # Generated layouts reserve a conservative body-clearance envelope around solids.
    # Dilation occurs once at construction; legacy layouts retain their original grid.
    padding = max(int(layout.get("navigation", {}).get("clearance_padding", 0)), math.ceil((layout.get("navigation", {}).get("robot_radius",0)+layout.get("navigation", {}).get("safety_margin",0))/cs))
    if padding:
        source = bytes(cells)
        for row in range(rows):
            for col in range(cols):
                if source[row * cols + col] == 1:
                    for dz in range(-padding, padding + 1):
                        for dx in range(-padding, padding + 1):
                            x, z = col + dx, row + dz
                            if 0 <= x < cols and 0 <= z < rows:
                                cells[z * cols + x] = 1
                if col < padding or row < padding or col >= cols-padding or row >= rows-padding:
                    cells[row * cols + col] = 1
