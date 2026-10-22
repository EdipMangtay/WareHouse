"""Read-only, same-snapshot route comparison on the warehouse's actual navigation grid.

Bellman-Ford uses its queue-based (SPFA) relaxation schedule. All three searches use
identical nonnegative weights, forbid corner cutting, and respect blocked goals.
The experiment does not change the production robot planner (which remains A*).
"""
from __future__ import annotations

import asyncio
import copy
import heapq
import math
import time
from collections import deque
from typing import Any, Callable

from fastapi import APIRouter, HTTPException, Query

from .sim.astar import DIRS, NavGrid, can_traverse, is_walkable, nearest_walkable


def search(grid: NavGrid, start: tuple[int, int], goal: tuple[int, int],
           algorithm: str, blocked: set[tuple[int, int]] | None = None,
           costs: list[float] | None = None, budget: int = 2_000_000) -> dict[str, Any]:
    if algorithm not in ("astar", "dijkstra", "bellman_ford"):
        raise ValueError("Unknown algorithm")
    if costs is not None and (len(costs) != len(grid.cells) or any(not math.isfinite(c) or c < 0 for c in costs)):
        raise ValueError("Costs must be finite, nonnegative and match the grid")
    began = time.perf_counter()
    blocked = set(blocked or ())
    blocked.discard(start)
    expanded = relaxed = 0
    distance: dict[tuple[int, int], float] = {start: 0}
    previous: dict[tuple[int, int], tuple[int, int]] = {}
    limited = False

    def neighbors(cell: tuple[int, int]):
        x, y = cell
        for dx, dy, base in DIRS:
            nx, ny = x + dx, y + dy
            if not can_traverse(grid,cell,(nx,ny)) or not is_walkable(grid, nx, ny, blocked):
                continue
            if dx and dy and (not is_walkable(grid, x + dx, y, blocked) or not is_walkable(grid, x, y + dy, blocked)):
                continue
            index = ny * grid.cols + nx
            yield (nx, ny), base * (1.6 if grid.cells[index] == 2 else 1) + (costs[index] if costs is not None else 0)

    def heuristic(cell: tuple[int, int]) -> float:
        if algorithm != "astar":
            return 0
        dx, dy = abs(cell[0] - goal[0]), abs(cell[1] - goal[1])
        return max(dx, dy) + (math.sqrt(2) - 1) * min(dx, dy)

    valid = is_walkable(grid, *start) and is_walkable(grid, *goal, blocked)
    if valid and algorithm == "bellman_ford":
        queue = deque([start]); queued = {start}
        while queue:
            cell = queue.popleft(); queued.remove(cell); expanded += 1
            for neighbor, cost in neighbors(cell):
                relaxed += 1
                if relaxed > budget:
                    limited = True; break
                candidate = distance[cell] + cost
                if candidate + 1e-12 < distance.get(neighbor, math.inf):
                    distance[neighbor] = candidate; previous[neighbor] = cell
                    if neighbor not in queued:
                        queue.append(neighbor); queued.add(neighbor)
            if limited:
                break
    elif valid:
        heap = [(heuristic(start), 0.0, start)]
        while heap:
            _, best, cell = heapq.heappop(heap)
            if best > distance[cell]:
                continue
            expanded += 1
            if cell == goal:
                break
            for neighbor, cost in neighbors(cell):
                relaxed += 1
                if relaxed > budget:
                    limited = True; break
                candidate = best + cost
                if candidate + 1e-12 < distance.get(neighbor, math.inf):
                    distance[neighbor] = candidate; previous[neighbor] = cell
                    heapq.heappush(heap, (candidate + heuristic(neighbor), candidate, neighbor))
            if limited:
                break
    found = valid and goal in distance and not limited
    path: list[tuple[int, int]] = []
    if found:
        cell = goal
        while cell != start:
            path.append(cell); cell = previous[cell]
        path.append(start); path.reverse()
    meters = grid.cell_size * sum(math.dist(a, b) for a, b in zip(path, path[1:]))
    return {"algorithm": algorithm, "status": "budget_exceeded" if limited else "found" if found else "unreachable",
            "cost": round(distance[goal], 5) if found else None, "distance_m": round(meters, 3) if found else None,
            "duration_ms": round((time.perf_counter() - began) * 1000, 3), "expanded_nodes": expanded,
            "relaxations": relaxed, "path": path}


def compare(grid: NavGrid, start: tuple[int, int], goal: tuple[int, int], blocked: set[tuple[int, int]], costs: list[float] | None):
    return [search(grid, start, goal, algorithm, blocked, costs) for algorithm in ("astar", "dijkstra", "bellman_ford")]


def create_routing_router(get_server: Callable[[], Any]) -> APIRouter:
    router = APIRouter(prefix="/api/routing", tags=["warehouse-routing"])
    lock = asyncio.Lock()

    @router.get("/compare")
    async def compare_routes(robot_id: str | None = Query(None, max_length=80), target_id: str | None = Query(None, max_length=80)):
        if lock.locked():
            raise HTTPException(503, "Bir rota karşılaştırması zaten çalışıyor.")
        async with lock:
            engine = get_server().engine
            robot = engine.state["robots"].get(robot_id) if robot_id else next(iter(engine.state["robots"].values()), None)
            if robot is None:
                raise HTTPException(404, "Robot bulunamadı.")
            floor = robot["floor"]
            location = engine.loc.get(target_id) if target_id else next((loc for loc in engine.loc.values() if loc.get("floor", 1) == floor and loc["kind"] == "PACKING"), None)
            if location is None:
                location = next((loc for loc in engine.loc.values() if loc.get("floor", 1) == floor), None) if not target_id else None
            if location is None:
                raise HTTPException(404, "Hedef bulunamadı.")
            if location.get("floor", 1) != floor:
                raise HTTPException(422, "Karşılaştırma için robot ve hedef aynı katta olmalı.")
            engine._sync_navigation()
            original = engine.grids[floor]
            grid = copy.deepcopy(original)
            blocked = engine._blocked_cells(robot["id"], floor)
            costs = engine._congestion_cost(floor)
            start = nearest_walkable(grid, robot["position"][0], robot["position"][2])
            goal = nearest_walkable(grid, *location["access_point"])
            tick = engine.state["sim"]["tick"]
            results = await asyncio.to_thread(compare, grid, start, goal, blocked, costs)
            return {"tick": tick, "robot_id": robot["id"], "target_id": location["id"], "floor": floor,
                    "start": start, "goal": goal, "blocked_cells": len(blocked), "results": results,
                    "note": "Aynı depo anlık görüntüsü; trafik ağırlıklı maliyet. Bellman-Ford kuyruk tabanlıdır. Canlı robotlar A* kullanır."}

    return router
