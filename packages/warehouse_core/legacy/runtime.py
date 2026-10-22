"""Shared constants, deterministic RNG and robot runtime for the preserved navigation model."""
from __future__ import annotations
import math
from typing import Any, Optional

# ─────────────────────────────────────────────────────────────
# 常數（與 twin_state.ts THRESHOLDS / engine.ts SIM 相同）
# ─────────────────────────────────────────────────────────────
TH = dict(BATTERY_WARNING=20, BATTERY_CRITICAL=10, BATTERY_CHARGE_TO=95, CONGESTION_WARNING=0.6,
          CONGESTION_BLOCK=0.85, TICK_MS=100, EVENT_RING_SIZE=500, THROUGHPUT_SERIES_SIZE=120)
SIM = dict(
    TICK_S=0.1, MAX_SPEED=1.5, ACCEL=1.2, TURN_SLOW=0.5, PICK_TICKS=40, DROP_TICKS=30,
    BATTERY_MOVE=0.010, BATTERY_LOAD=0.004, BATTERY_IDLE=0.0008, CHARGE_RATE=0.06,
    TASK_INTERVAL_TICKS=70, MAX_WAITING_TASKS=12, WAIT_REPLAN_TICKS=25, WAIT_BACKOFF_TICKS=80, STATION_ARRIVE_CELLS=2, SERVICE_RADIUS=1, MIN_SEP=0.9, ON_TIME_LIMIT_TICKS=2400,
    IDLE_TO_PARK_TICKS=300, KPI_EVERY=10, SERIES_EVERY=600, EVENT_RING=500, ZONE_CAPACITY=6,
    # Phase 7：虛擬 LiDAR 與局部避障（與 TS 引擎相同）
    LIDAR_RANGE=4.0, LIDAR_FOV=math.pi * 1.5, PERC_STOP=1.7, PERC_SLOW=2.8, PERC_LOOKAHEAD=3, PERC_EVENT_TICKS=200,
    LIFT_SEP=0.6,   # 電梯口「對接模式」間距 (m)：排隊遞補/進出轎廂的低速微移動用，比走道 MIN_SEP 緊
    # 電梯門區幾何（round-8c）：與前端 Mezzanine 井道模型一致（W 2.8 / 雙開門單片 LEAF 1.12）
    LIFT_SHAFT_HALF_X=1.4, LIFT_DOOR_HALF_W=1.12, ROBOT_HALF_LEN=0.475, ROBOT_HALF_W=0.34,
    LIFT_DOOR_TICKS=12, LIFT_TRAVEL_TICKS=60, LIFT_LEVEL_TICKS=5, LIFT_COOLDOWN_TICKS=20,
    LIFT_BOARD_SPEED=0.6, LIFT_QUEUE_SPEED=0.9, LIFT_RETRY_TICKS=50, LIFT_XFLOOR_PENALTY_M=40,
)

MASK = 0xFFFFFFFF


def _imul(a: int, b: int) -> int:
    return (a * b) & MASK


class Mulberry32:
    """與 JS 版 bit-level 一致的 PRNG。做成物件（不是 closure）讓引擎可以 deepcopy → What-if 複製後亂數流也一致。"""
    __slots__ = ("s",)

    def __init__(self, seed: int) -> None:
        self.s = seed & MASK

    def __call__(self) -> float:
        self.s = (self.s + 0x6D2B79F5) & MASK
        t = self.s
        t = _imul(t ^ (t >> 15), 1 | t)
        t = ((t + _imul(t ^ (t >> 7), 61 | t)) ^ t) & MASK
        return ((t ^ (t >> 14)) & MASK) / 4294967296


def mulberry32(seed: int) -> Mulberry32:
    return Mulberry32(seed)


def jsround(x: float) -> int:
    """JS Math.round：.5 往 +∞。"""
    return math.floor(x + 0.5)


def js_to_fixed0(x: float) -> str:
    return str(jsround(x)) if x >= 0 else str(-jsround(-x))


def _sign(x: float) -> float:
    return 1.0 if x > 0 else -1.0 if x < 0 else 0.0


class RobotRt:
    __slots__ = ("dwell", "wait_ticks", "target", "goal_loc", "phase", "charger_id", "idle_ticks", "last_battery_alert", "backing_off", "resume_point",
                 "front_id", "front_dist", "last_perc_event", "pending", "lift_id", "lift_stage", "lift_enqueued_tick", "lift_retry_tick",
                 "lift_exit", "lift_blocked_ticks", "planned_lift_id", "lift_exit_phase", "lift_queue_goal")

    def __init__(self) -> None:
        self.backing_off = False; self.resume_point: Optional[tuple[float, float]] = None
        self.dwell = 0; self.wait_ticks = 0; self.target: Optional[tuple[int, int]] = None
        self.goal_loc: Optional[str] = None; self.phase: Optional[str] = None
        self.charger_id: Optional[str] = None; self.idle_ticks = 0; self.last_battery_alert = "NONE"
        self.front_id: Optional[str] = None; self.front_dist = math.inf; self.last_perc_event = -10**9
        self.pending: Optional[dict[str, Any]] = None; self.lift_id: Optional[str] = None
        self.lift_stage: Optional[str] = None; self.lift_enqueued_tick = 0; self.lift_retry_tick = 0
        self.lift_exit: Optional[tuple[float, float]] = None; self.lift_blocked_ticks = 0
        # 派工當下稽核記錄的電梯（round-6 P2）：_plan_to 跨樓層時優先使用，確保 Decision reasons 與實際路線一致
        self.planned_lift_id: Optional[str] = None
        # 三階段離梯（round-8d）：TURN_OUT → OUT → TURN_EXIT → GO
        self.lift_exit_phase: Optional[str] = None
        self.lift_queue_goal: Optional[tuple[float, float]] = None


