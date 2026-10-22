"""
Digital Twin 模擬引擎 — frontend/src/simulation/engine.ts 的 Python 移植版。

對應關係：方法名稱、tick 順序、FSM、評分權重、SIM 參數與 TS 版逐一相同。
state 以純 dict 表示（與 TwinState JSON 完全一致），Pydantic 驗證在 API 邊界進行。
"""
from __future__ import annotations

import math
from typing import Any, Optional

from .astar import NavGrid, astar, can_traverse, cell_center, is_walkable, nearest_walkable, to_cell
from .navgrid import build_nav_grid
from .rules import task_error

from .runtime import TH, SIM, RobotRt, Mulberry32, mulberry32, jsround, js_to_fixed0, _sign
from .lifts import LiftOperations
from .navigation import NavigationOperations
from .fleet import FleetOperations
from .monitoring import MonitoringOperations
from .motion import MotionConfig

class SimEngine(LiftOperations, NavigationOperations, FleetOperations, MonitoringOperations):
    def __init__(self, layout: dict[str, Any], seed: int = 42, initial_state: Optional[dict[str, Any]] = None) -> None:
        if layout.get('units') != 'm' or layout['grid']['cell_size'] != 1:
            raise ValueError('Current movement and lift controller requires 1 m cells')
        self.layout = layout
        self.motion = MotionConfig(**layout.get('robot_motion', {}))
        self.grid: NavGrid = build_nav_grid(layout, 1)
        self.grids: dict[int, NavGrid] = {1: self.grid}
        for f in layout.get("floors", []):
            if f["id"] != 1:
                self.grids[f["id"]] = build_nav_grid(layout, f["id"])

        n = self.grid.cols * self.grid.rows
        # 交通熱圖：每樓一份（round-5 修正：二樓不再顯示一樓的資料）
        _floors = layout.get("floors") or [{"id": 1}]
        self.traffic: dict[int, list[float]] = {f["id"]: [0.0] * n for f in _floors}
        self.traffic_short: dict[int, list[float]] = {f["id"]: [0.0] * n for f in _floors}
        self.loc = {l["id"]: l for l in layout["locations"]}
        self.rng = mulberry32(seed)
        self.rt: dict[str, RobotRt] = {}
        self.occupancy: dict[tuple[int, int, int], str] = {}   # (floor, col, row) → robot_id
        self.task_seq = 3812; self.event_seq = 0; self.decision_seq = 0
        self.charger_busy: dict[str, Optional[str]] = {c["id"]: None for c in layout["charging_stations"]}
        self.blocked_zones: set[str] = set()
        self.navigation_blocks = {floor:set() for floor in self.grids}
        self.navigation_revision = 0
        self._navigation_zone_stamp = None
        self.congested_zones: dict[str, dict[str, float]] = {}   # zone → {level, until}
        self.pending_injections: list[dict[str, Any]] = []
        self.task_times: list[int] = []
        self.on_time = 0; self.completed_count = 0; self.last_series_tick = 0
        self.state: dict[str, Any] = (__import__("copy").deepcopy(initial_state) if initial_state else self._build_initial_state(seed))
        for r in self.state["robots"].values():   # 舊版快照相容
            r.setdefault("perception", {"state": "CLEAR", "ahead_m": SIM["LIDAR_RANGE"], "nearest_m": None, "obstacles": []})
            r.setdefault("floor", 1); r.setdefault("lift_id", None); r.setdefault("lift_stage", None)
        if "lifts" not in self.state:
            self.state["lifts"] = self._initial_lifts()
        for L in self.state["lifts"].values():   # 舊版快照相容
            L.setdefault("fault_remaining", 0)
        for rid in self.state["robots"]:
            self.rt[rid] = RobotRt()
        self.next_task_tick = self.state["sim"]["tick"] + 10
        # 每 tick 新產生的事件（給 WebSocket PATCH 用），由呼叫端清空
        self.new_events: list[dict[str, Any]] = []
        self._zone_bounds = {z["id"]: (min(p[0] for p in z["polygon"]), min(p[1] for p in z["polygon"]),
                                       max(p[0] for p in z["polygon"]), max(p[1] for p in z["polygon"])) for z in layout["zones"]}
        from .conveyor import ConveyorController
        self.conveyor = ConveyorController(layout)
        self.conveyor.initialize(self.state)
        self._zone_floor = {z["id"]: z.get("floor", 1) for z in layout["zones"]}

    # ─────────────────────────────────────────────────────────
    def _initial_lifts(self) -> dict[str, Any]:
        return {l["id"]: {
            "id": l["id"], "state": "IDLE", "floor": 1, "target_floor": None, "y": 0.0,
            "door_f1": "CLOSED", "door_f2": "CLOSED",
            "occupant": None, "reserved_by": None, "queue": {"1": [], "2": []},
            "until_tick": 0, "fault": False, "fault_remaining": 0, "trips": 0, "busy_ticks": 0, "wait_total_ticks": 0, "wait_n": 0,
        } for l in self.layout.get("lifts", [])}

    def _build_initial_state(self, seed: int) -> dict[str, Any]:
        L = self.layout
        robots: dict[str, Any] = {}
        for sp in L["spawn"]["robots"]:
            robots[sp["id"]] = {
                "id": sp["id"], "model": "AMR-L", "position": [math.floor(sp["position"][0]) + 0.5, 0, math.floor(sp["position"][2]) + 0.5], "heading": sp["heading"],
                "floor": sp.get("floor", 1), "lift_id": None, "lift_stage": None,
                "velocity": 0, "max_speed": self.motion.max_speed_mps, "battery": sp["battery"], "status": "IDLE", "fsm": "IDLE",
                "health": 95 + math.floor(self.rng() * 5), "current_task_id": None, "destination": None, "path": [], "path_index": 0,
                "load": {"current": 0, "capacity": 4}, "home_zone": sp.get("home_zone"), "payload_package_id": None, "zone": None, "eta_s": None, "fsm_since_tick": 0,
                "operation_duration_ticks": 0, "operation_elapsed_ticks": 0,
                "stats": {"distance_m": 0, "tasks_completed": 0, "energy_wh": 0, "busy_ticks": 0, "wait_ticks": 0},
                "perception": {"state": "CLEAR", "ahead_m": SIM["LIDAR_RANGE"], "nearest_m": None, "obstacles": []},
            }
        n = len(robots)
        return {
            "schema_version": "1.0", "layout_id": L["id"],
            "sim": {"tick": 0, "tick_ms": TH["TICK_MS"], "speed": 1, "mode": "LIVE", "seed": seed, "baseline_snapshot_id": None},
            "robots": robots, "tasks": {}, "lifts": self._initial_lifts(),
            "zones": {z["id"]: {"id": z["id"], "status": "NORMAL", "robot_count": 0, "congestion": 0, "blocked_reason": None, "blocked_since_tick": None} for z in L["zones"]},
            "conveyors": {c["id"]: {"id": c["id"], "status": "RUNNING", "speed_mps": c["speed_mps"], "items_on_belt": 4, "throughput_per_min": 4} for c in L["conveyors"]},
            "cameras": {c["id"]: {"id": c["id"], "zone": c["zone"], "status": "ONLINE", "last_observation": None} for c in L["cameras"]},
            "sensors": {s["id"]: {"id": s["id"], "kind": s["kind"], "zone": s["zone"], "status": "ONLINE", "value": None, "unit": None} for s in L["sensors"]},
            "people": {}, "alerts": {}, "recent_events": [], "recent_decisions": [],
            "kpi": {
                "tick": 0, "fleet": {"total": n, "active": 0, "charging": 0, "idle": n, "warning": 0, "error": 0, "offline": 0},
                "operation": {"throughput_per_min": 0, "completed_today": 0, "completed_target": 150, "pending": 0, "ongoing": 0, "avg_task_time_s": 0, "on_time_rate": 1, "avg_utilization": 0},
                "efficiency": {"avg_travel_distance_m": 0, "avg_wait_time_s": 0, "congestion_index": 0, "energy_kwh": 0},
                "throughput_series": [{"tick": 0, "completed": 0, "target": 0}],
            "lifts": {"trips": 0, "utilization": 0, "avg_wait_s": 0, "faults": 0},
            },
            "subsystems": {"WAREHOUSE": "NORMAL", "CONVEYORS": "NORMAL", "CHARGING": "NORMAL", "CCTV": "NORMAL", "NETWORK": "NORMAL"},
        }

    # ─────────────────────────────────────────────────────────
    # 公開 API
    # ─────────────────────────────────────────────────────────
    def clone(self) -> "SimEngine":
        """完整複製（state + FSM 執行期 + 充電樁 + 亂數狀態）。layout 唯讀共用；grid 的動態封鎖獨立複製。"""
        import copy
        new = SimEngine.__new__(SimEngine)
        for k, v in self.__dict__.items():
            if k in ("layout", "loc", "_zone_bounds", "_zone_floor"):
                setattr(new, k, v)
            else:
                setattr(new, k, copy.deepcopy(v))
        new.grid = new.grids[1]
        new.new_events = []
        return new

    def inject(self, inj: dict[str, Any]) -> None:
        self.pending_injections.append(inj)
        tgt = inj.get("zone_id") and f" (Zone {inj['zone_id']})" or inj.get("robot_id") and f" ({inj['robot_id']})" or inj.get("conveyor_id") and f" ({inj['conveyor_id']})" or inj.get("camera_id") and f" ({inj['camera_id']})" or ""
        self.emit("SCENARIO_INJECTED", "USER", "INFO", f"Scenario injected: {inj['kind']}{tgt}")

    def block_zone(self, zone_id: str, reason: str, duration_ticks: int) -> None:
        """由感知（VLM）觸發的 Zone 封鎖：不放人員模型，純封鎖 + 到期解除。"""
        S = self.state; now = S["sim"]["tick"]
        if zone_id not in S["zones"]: return
        pid = f"VLM-{zone_id}-{now}"
        b = self._zone_bounds[zone_id]
        S["people"][pid] = {"id": pid, "kind": "WORKER", "position": [(b[0] + b[2]) / 2, 0, b[1] + 6.3], "heading": 0, "zone": zone_id, "floor": self._zone_floor.get(zone_id, 1), "expires_tick": now + duration_ticks}
        if zone_id not in self.blocked_zones:
            self.blocked_zones.add(zone_id); S["zones"][zone_id]["blocked_reason"] = reason; S["zones"][zone_id]["blocked_since_tick"] = now
            self.emit("ZONE_BLOCKED", "VLM", "HIGH", f"Zone {zone_id} marked BLOCKED ({reason})", zone_id=zone_id)
            self._raise_alert(f"zone-{zone_id}", "HIGH", f"Zone {zone_id}  Human Detected", "VLM · route blocked", zone_id=zone_id)
            x0, z0, x1, z1 = b
            for r in S["robots"].values():
                if r["path"] and any(x0 <= c[0] < x1 and z0 <= c[1] < z1 for c in r["path"][r["path_index"]:]):
                    self._set_fsm(r, "OBSTACLE_DETECTED")

    def clear_injection(self, kind: str, target_id: str) -> None:
        """解除注入：機器人恢復上線、輸送帶恢復、攝影機上線、人員離開、交通擁塞解除"""
        S = self.state
        if kind == "ROBOT_FAILURE":
            r = S["robots"].get(target_id)
            if r and r["fsm"] == "OFFLINE":
                if r.get('payload_package_id'):
                    task=S['tasks'][r['current_task_id']]
                    if self.conveyor.claim_induction(S,task,r):
                        dest=self.loc[task['handoff_station']]
                        self._plan_to(r,self.rt[r['id']],tuple(dest['access_point']),'TO_DEST',dest['id'])
                    else:
                        spawn=next(s for s in self.layout['spawn']['robots'] if s['id']==r['id'])
                        self._plan_to(r,self.rt[r['id']],tuple(spawn['position'][::2]),'TO_INDUCTION_QUEUE')
                    self._set_fsm(r,'TRANSPORTING')
                else:
                    self._set_fsm(r, "IDLE"); self.rt[r["id"]].phase = None; self.rt[r["id"]].target = None
                self._resolve_alert(f"off-{r['id']}"); self.emit("ROBOT_ONLINE", "USER", "INFO", f"{r['id']} back online", robot_id=r["id"])
        elif kind == "CONVEYOR_FAILURE":
            c = S["conveyors"].get(target_id); lc = next((x for x in self.layout["conveyors"] if x["id"] == target_id), None)
            if c and lc:
                c["status"] = "RUNNING"; c["speed_mps"] = lc["speed_mps"]; self._resolve_alert(f"cv-{c['id']}")
                self.emit("CONVEYOR_STATUS_CHANGED", "CONVEYOR", "INFO", f"{c['id']} restored — RUNNING", conveyor_id=c["id"])
        elif kind == "CAMERA_OFFLINE":
            c = S["cameras"].get(target_id)
            if c:
                c["status"] = "ONLINE"
                if all(x["status"] == "ONLINE" for x in S["cameras"].values()): S["subsystems"]["CCTV"] = "NORMAL"
                self.emit("CAMERA_STATUS_CHANGED", "CAMERA", "INFO", f"{c['id']} online", camera_id=c["id"])
        elif kind == "HUMAN_INTRUSION":
            for p in S["people"].values():
                if p["zone"] == target_id: p["expires_tick"] = S["sim"]["tick"]
        elif kind == "TRAFFIC_CONGESTION":
            self.congested_zones.pop(target_id, None)
            self.emit("ZONE_UNBLOCKED", "USER", "INFO", f"Zone {target_id} traffic restriction lifted", zone_id=target_id)
        elif kind == "LIFT_FAULT":
            L = S["lifts"].get(target_id)
            if L and L["fault"]:
                L["fault"] = False
                # 從凍結的剩餘進度續跑（round-5 修正：平台不瞬移）
                L["until_tick"] = S["sim"]["tick"] + L.get("fault_remaining", 0)
                L["fault_remaining"] = 0
                self._resolve_alert(f"lift-{target_id}")
                self.emit("LIFT_FAULT", "LIFT", "INFO", f"{target_id} restored — resuming")

    def create_task(self, type_: str, priority: str, source: str, destination: str, load_units: int = 1, *, order_id: str | None = None, package_id: str | None = None) -> dict[str, Any]:
        err = task_error(self.loc, type_, source, destination)
        if err:
            raise ValueError(err)
        tid = f"A{self.task_seq}"; self.task_seq += 1
        tick = self.state["sim"]["tick"]
        task = {"id": tid, "type": type_, "priority": priority, "status": "WAITING", "source": source, "destination": destination,
                "assigned_robot": None, "parent_task_id": None, "created_tick": tick, "assigned_tick": None, "started_tick": None,
                "completed_tick": None, "deadline_tick": tick + SIM["ON_TIME_LIMIT_TICKS"], "eta_s": None, "load_units": load_units}
        if self.layout.get('conveyor_network') and type_ in ('PICK', 'TRANSPORT'):
            self.conveyor.register(self.state, task, order_id, package_id)
        self.state["tasks"][tid] = task
        self.emit("TASK_CREATED", "SIMULATION", "INFO", f"Task #{tid} created ({type_} {self.pretty(source)} → {self.pretty(destination)})", task_id=tid)
        return task

    def ack_alert(self, aid: str) -> None:
        a = self.state["alerts"].get(aid)
        if a:
            a["acknowledged"] = True

    def step(self) -> None:
        S = self.state
        S["sim"]["tick"] += 1
        tick = S["sim"]["tick"]
        self._apply_injections()
        self._sync_navigation()
        self._generate_tasks()
        self._assign_tasks()
        self._rebuild_occupancy()
        self._step_lifts()
        for rid in list(S["robots"].keys()):
            self._update_perception(S["robots"][rid], self.rt[rid])
        for rid in list(S["robots"].keys()):
            self._step_robot(S["robots"][rid], self.rt[rid])
        for p in self.conveyor.step(S) or []:
            self.emit('PARCEL_DELIVERED','CONVEYOR','INFO',f"{p['package_id']} delivered to {p['destination_station']}",payload={'package_id':p['package_id'],'order_id':p['order_id'],'destination':p['destination_station']})
        self._update_zones()
        self._decay_traffic()
        if tick % SIM["KPI_EVERY"] == 0:
            self._update_kpi(); self._update_devices()
        if tick - self.last_series_tick >= SIM["SERIES_EVERY"]:
            self._push_series()
        self._prune_tasks()

    # ─────────────────────────────────────────────────────────
    # 任務
    # ─────────────────────────────────────────────────────────



    # ─────────────────────────────────────────────────────────
    # FSM
    # ─────────────────────────────────────────────────────────


    # ─────────────────────────────────────────────────────────
    # 電梯（規格書 §6/§9/§10/§11/§13/§14）— 與 TS 引擎邏輯相同；此引擎（後端）是唯一權威
    # ─────────────────────────────────────────────────────────















    # ─────────────────────────────────────────────────────────
    # 路徑與移動
    # ─────────────────────────────────────────────────────────










    # ─────────────────────────────────────────────────────────
    # Phase 7：虛擬 LiDAR 感知（270° / 4 m），邏輯與 TS 引擎相同
    # ─────────────────────────────────────────────────────────









    # ─────────────────────────────────────────────────────────
    # 電池
    # ─────────────────────────────────────────────────────────






    # ─────────────────────────────────────────────────────────
    # Zone / KPI / 事件
    # ─────────────────────────────────────────────────────────







    # ─────────────────────────────────────────────────────────
    # 情境注入
    # ─────────────────────────────────────────────────────────

    def pretty(self, loc_id: str) -> str:
        l = self.loc.get(loc_id)
        if not l: return loc_id
        k = l["kind"]
        if k == "SHELF": return "Shelf " + loc_id.replace("SHELF-", "")
        if k == "PACKING": return loc_id.replace("PACK-", "Packing ")
        if k == "SORTING": return "Sorting"
        if k == "CHARGING": return loc_id.replace("CHG-", "Charger ")
        return loc_id.replace("-", " ", 1)
