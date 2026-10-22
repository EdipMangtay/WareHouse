import math

import pytest
from app.routing import compare, search
from app.sim.astar import NavGrid


def test_algorithms_same_optimal_weighted_cost_and_detour():
    grid = NavGrid(8, 6, bytearray(48))
    costs = [0.0] * 48
    for x in range(1, 7):
        costs[2 * 8 + x] = 10
    results = compare(grid, (0, 2), (7, 2), {(3, 1)}, costs)
    assert all(r["status"] == "found" for r in results)
    assert len({r["cost"] for r in results}) == 1
    assert results[0]["cost"] < 15
    for result in results:
        assert [3, 1] not in [list(p) for p in result["path"]]
        assert result["path"][0] == (0, 2)
        assert result["path"][-1] == (7, 2)


@pytest.mark.parametrize("algorithm", ["astar", "dijkstra", "bellman_ford"])
def test_blocked_goal_and_corner_cutting(algorithm):
    grid = NavGrid(2, 2, bytearray([0, 1, 1, 0]))
    assert search(grid, (0, 0), (1, 1), algorithm)["status"] == "unreachable"
    grid = NavGrid(2, 2, bytearray(4))
    assert search(grid, (0, 0), (1, 1), algorithm, {(1, 1)})["status"] == "unreachable"
    same = search(grid, (0, 0), (0, 0), algorithm)
    assert same["status"] == "found" and same["cost"] == 0
    assert search(grid, (-1, 0), (1, 1), algorithm)["status"] == "unreachable"


def test_budget_exhaustion_not_reported_as_optimal():
    result = search(NavGrid(20, 20, bytearray(400)), (0, 0), (19, 19), "bellman_ford", budget=5)
    assert result["status"] == "budget_exceeded"
    assert result["cost"] is None and not result["path"]


def test_negative_or_nonfinite_cost_rejected():
    for bad in [-1, math.nan, math.inf]:
        with pytest.raises(ValueError):
            search(NavGrid(2, 2, bytearray(4)), (0, 0), (1, 1), "astar", costs=[bad] * 4)
