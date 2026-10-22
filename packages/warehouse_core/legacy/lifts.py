"""Preserved lifts behaviour, composed by SimEngine; owns no separate state."""
from __future__ import annotations
import math
from typing import Any, Optional
from .astar import NavGrid, astar, can_traverse, cell_center, is_walkable, nearest_walkable, to_cell
from .runtime import TH, SIM, RobotRt, mulberry32, jsround, js_to_fixed0, _sign
from .motion import angle_delta, advance_speed, route_eta, _run_duration

class LiftOperations:
    def _lift_layout(self, lid: str) -> dict[str, Any]:
        return next(l for l in self.layout["lifts"] if l["id"] == lid)


    def _elev_of(self, floor: int) -> float:
        return next((f["elevation"] for f in self.layout.get("floors", []) if f["id"] == floor), 0.0)


    @staticmethod
    def _lift_slot(l: dict[str, Any], i: int) -> tuple[float, float]:
        # 排隊格（round-9b 再退一格）：slot0 = cell−4，距轉向安全點 1.916 m ——
        # 原地旋轉掃掠（對角半徑 0.584）對上任意朝向的排隊車（最壞 0.584）需要 ≥ 1.17 m 才保證不碰；
        # 舊的 cell−3（相距 0.916 m）光是兩台面對面站著（0.475+0.475=0.95）就會車體重疊
        return (l["cell"][0] - 4 - i + 0.5, l["cell"][1] + 0.5)


    @staticmethod
    def _lift_cabin(l: dict[str, Any]) -> tuple[float, float]:
        return (l["cell"][0] + 0.5, l["cell"][1] + 0.5)


    def _lift_gate_point(self, l: dict[str, Any]) -> tuple[float, float]:
        """閘門通過點＝轉向安全點（round-8d）：門軸正中央（z = cz，不偏移 —— 偏移會讓車體掃過門框）。
        x = 門面 − 車體【對角半徑】− 0.10 m 餘裕（≈ cx − 2.084）：長方形車體原地旋轉的掃掠圓半徑是
        √(半長² + 半寬²) ≈ 0.584 m，只用半長會在最不利角度侵入門面 —— 到這裡整台車連旋轉都不碰門框。
        排隊線在 cell−4−i（round-9b），此點與佔用中的 slot0 相距 ≈ 1.916 m —— 原地旋轉掃掠對排隊車也安全。"""
        cx = l["cell"][0] + 0.5; cz = l["cell"][1] + 0.5
        return (cx - (SIM["LIFT_SHAFT_HALF_X"] + math.hypot(SIM["ROBOT_HALF_LEN"], SIM["ROBOT_HALF_W"]) + 0.10), cz)


    def _pick_lift_exit(self, l: dict[str, Any], floor: int, toward: Optional[tuple[float, float]] = None, skip: int = 0) -> tuple[float, float]:
        """出口節點（規格書 §6.4）：與排隊線分開；出轎廂走「門軸 → 閘門 → 出口」兩段路（round-8b），
        兩段都必須避開所有站著的機器人；一次選定（sticky），被擋太久才換 —— 與 TS 相同。"""
        grid = self.grids[floor]
        cabin = self._lift_cabin(l)

        def seg_clear(ax: float, az: float, bx: float, bz: float) -> bool:
            dx = bx - ax; dz = bz - az; len2 = dx * dx + dz * dz or 1.0
            for o in self.state["robots"].values():
                if o["floor"] != floor or o["lift_id"] or o["velocity"] > 0.1:
                    continue
                t = max(0.0, min(1.0, ((o["position"][0] - ax) * dx + (o["position"][2] - az) * dz) / len2))
                d = math.hypot(o["position"][0] - (ax + dx * t), o["position"][2] - (az + dz * t))
                if d < SIM["LIFT_SEP"]:   # 門區用「對接模式」間距（round-8e）；實際移動也是 LIFT_SEP 在擋
                    return False
            return True

        g = self._lift_gate_point(l)

        def clear(to: tuple[float, float]) -> bool:   # 兩段都要淨空：轎廂→閘門、閘門→出口
            return seg_clear(cabin[0], cabin[1], g[0], g[1]) and seg_clear(g[0], g[1], to[0], to[1])

        # round-8e：出口不再固定順序輪流，改成「離下一個目的地最近優先」——目的地在南邊就往南出，不會轉錯邊繞路；
        # 貼著圍籬的 (-2, ±2) 加 0.75 m 懲罰，路線不再沿著井道邊框平行走
        # round-9b：站立淨空 —— 站上出口後還要能原地轉向離開（對角半徑 + 對方半長），太靠近站立車的候選不選
        stand_clear_r = math.hypot(SIM["ROBOT_HALF_LEN"], SIM["ROBOT_HALF_W"]) + SIM["ROBOT_HALF_LEN"]

        def stand_clear(p: tuple[float, float]) -> bool:
            for o in self.state["robots"].values():
                if o["floor"] != floor or o["lift_id"] or o["velocity"] > 0.1:
                    continue
                if math.hypot(p[0] - o["position"][0], p[1] - o["position"][2]) < stand_clear_r:
                    return False
            return True

        ok: list[tuple[float, tuple[float, float]]] = []
        for dc, dr in ((-2, -2), (-2, 2), (-3, -1), (-3, 1), (-3, -2), (-3, 2), (-2, 0)):
            c = l["cell"][0] + dc; r_ = l["cell"][1] + dr
            if not is_walkable(grid, c, r_):
                continue
            pnt = (c + 0.5, r_ + 0.5)
            if not clear(pnt) or not stand_clear(pnt):
                continue
            hug = 0.75 if (dc == -2 and dr != 0) else 0.0
            key = (math.hypot(pnt[0] - toward[0], pnt[1] - toward[1]) if toward else 0.0) + hug
            ok.append((key, pnt))
        ok.sort(key=lambda x: x[0])
        if ok:
            return ok[skip % len(ok)][1]
        return (l["cell"][0] - 2 + 0.5, l["cell"][1] - 2 + 0.5)


    @staticmethod
    def obb_overlap(ax: float, az: float, ah: float, bx: float, bz: float, bh: float, margin: float = 0.0) -> bool:
        """兩個旋轉矩形車體（OBB）是否相交 —— 分離軸定理（SAT），margin 為額外安全間隙（round-9b）"""
        hl = SIM["ROBOT_HALF_LEN"]; hw = SIM["ROBOT_HALF_W"]
        dx = bx - ax; dz = bz - az
        for t in (ah, ah + math.pi / 2, bh, bh + math.pi / 2):
            ux = math.cos(t); uz = math.sin(t)
            ra = hl * abs(ux * math.cos(ah) + uz * math.sin(ah)) + hw * abs(-ux * math.sin(ah) + uz * math.cos(ah))
            rb = hl * abs(ux * math.cos(bh) + uz * math.sin(bh)) + hw * abs(-ux * math.sin(bh) + uz * math.cos(bh))
            if abs(dx * ux + dz * uz) > ra + rb + margin:
                return False   # 找到分離軸 → 不相交
        return True


    def _micro_move(self, r: dict[str, Any], to: tuple[float, float], speed: float, floor_override: Optional[int] = None) -> bool:
        fl = floor_override if floor_override is not None else r["floor"]
        dx = to[0] - r["position"][0]; dz = to[1] - r["position"][2]
        dist = math.hypot(dx, dz)
        if dist < 1e-8:
            r["velocity"] = 0; return True
        move_h = math.atan2(dz, dx)
        turn = angle_delta(move_h,r["heading"])
        if abs(turn) > 1e-6:
            next_heading = r["heading"] + max(-self.motion.turn_rate_rad_s*SIM["TICK_S"],min(self.motion.turn_rate_rad_s*SIM["TICK_S"],turn))
            if not any(o["id"] != r["id"] and o["floor"] == fl and not o["lift_id"] and
                       self.obb_overlap(r["position"][0],r["position"][2],next_heading,o["position"][0],o["position"][2],o["heading"],.05)
                       for o in self.state["robots"].values()):
                r["heading"] = next_heading
            r["velocity"] = 0
            return False
        velocity = advance_speed(r["velocity"],min(speed,r["max_speed"]),dist,self.motion,SIM["TICK_S"])
        step = min(dist, velocity * SIM["TICK_S"])
        if dist < self.motion.deceleration_mps2*SIM["TICK_S"]**2/2 and velocity <= self.motion.deceleration_mps2*SIM["TICK_S"]:
            step = dist
        nx = r["position"][0] + (dx / dist) * step; nz = r["position"][2] + (dz / dist) * step
        # 排隊/進出轎廂維持物理間距，但用「對接模式」的 LIFT_SEP（0.6 m）：低速微移動
        # 若沿用走道的 MIN_SEP 0.9，門軸走廊會和排隊線在 0.9 m 標距上互相卡死（BOARDING ↔ TO_LIFT 對峙）
        for oid, o in self.state["robots"].items():
            if oid == r["id"] or o["floor"] != fl or o["lift_id"]:
                continue
            dn = math.hypot(nx - o["position"][0], nz - o["position"][2])
            dcur = math.hypot(r["position"][0] - o["position"][0], r["position"][2] - o["position"][2])
            if dn < SIM["LIFT_SEP"] and dn < dcur:
                r["velocity"] = 0; return False
            # round-9b：中心距之外再驗「旋轉車體 OBB」不相交（+5 cm 間隙）——只擋「會更靠近」的步，
            # 遠離中的分開動作放行，否則已重疊的既有狀態會鎖死
            if dn < dcur and dn < 1.5 and self.obb_overlap(nx, nz, move_h, o["position"][0], o["position"][2], o["heading"], 0.05):
                r["velocity"] = 0; return False
        r["position"][0] = nx; r["position"][2] = nz
        r["velocity"] = 0 if dist-step < 1e-8 else velocity
        r["stats"]["distance_m"] += step
        return dist-step < 1e-8


    def _set_lift_stage(self, r: dict[str, Any], rt: RobotRt, stage: Optional[str]) -> None:
        rt.lift_stage = stage; r["lift_stage"] = stage
        rt.lift_queue_goal = None


    def release_robot_from_lift(self, robot_id: str) -> None:
        S = self.state
        for lid, L in S["lifts"].items():
            for f in ("1", "2"):
                if robot_id in L["queue"][f]:
                    L["queue"][f].remove(robot_id)
            if L["reserved_by"] == robot_id:
                L["reserved_by"] = None
                self.emit("LIFT_RESERVATION_RELEASED", "LIFT", "LOW", f"{lid} reservation released ({robot_id})", robot_id=robot_id)
            if L["occupant"] == robot_id:
                L["occupant"] = None
                if L["state"] in ("BOARDING", "ALIGHTING"):
                    L["state"] = "DOOR_CLOSING_AFTER_EXIT"; L["until_tick"] = S["sim"]["tick"] + SIM["LIFT_DOOR_TICKS"]
        r = S["robots"].get(robot_id); rt = self.rt.get(robot_id)
        if r is not None and rt is not None:
            r["lift_id"] = None; self._set_lift_stage(r, rt, None); rt.lift_exit = None; rt.lift_blocked_ticks = 0; rt.lift_exit_phase = None


    def _step_lifts(self) -> None:
        S = self.state; tick = S["sim"]["tick"]
        for lid in sorted(S["lifts"].keys()):
            L = S["lifts"][lid]
            if L["fault"]:
                continue
            if L["state"] not in ("IDLE", "COOLDOWN"):
                L["busy_ticks"] += 1
            if L["state"] in ("MOVING_UP", "MOVING_DOWN"):
                t = min(1.0, max(0.0, 1 - (L["until_tick"] - tick) / SIM["LIFT_TRAVEL_TICKS"]))
                e = t * t * (3 - 2 * t)
                y0 = self._elev_of(1 if L["state"] == "MOVING_UP" else 2)
                y1 = self._elev_of(2 if L["state"] == "MOVING_UP" else 1)
                L["y"] = y0 + (y1 - y0) * e
            elif L["floor"] is not None:
                L["y"] = self._elev_of(L["floor"])
            if tick < L["until_tick"]:
                continue
            st = L["state"]
            if st == "IDLE":
                if not L["reserved_by"]:
                    heads = []
                    for f in ("1", "2"):
                        if L["queue"][f]:
                            rid = L["queue"][f][0]
                            heads.append((self.rt[rid].lift_enqueued_tick if rid in self.rt else 0, rid))
                    heads.sort()
                    if heads:
                        L["reserved_by"] = heads[0][1]
                        self.emit("LIFT_RESERVED", "LIFT", "INFO", f"{lid} reserved by {L['reserved_by']}", robot_id=L["reserved_by"])
                if L["reserved_by"]:
                    rr = S["robots"].get(L["reserved_by"])
                    if not rr or rr["status"] == "OFFLINE":
                        self.release_robot_from_lift(L["reserved_by"])
                    elif L["floor"] == rr["floor"]:
                        L["state"] = "DOOR_OPENING"; L["until_tick"] = tick + SIM["LIFT_DOOR_TICKS"]
                    else:
                        L["target_floor"] = rr["floor"]
                        L["state"] = "MOVING_UP" if rr["floor"] == 2 else "MOVING_DOWN"
                        L["floor"] = None; L["until_tick"] = tick + SIM["LIFT_TRAVEL_TICKS"]
            elif st in ("MOVING_UP", "MOVING_DOWN"):
                L["state"] = "LEVELING"; L["until_tick"] = tick + SIM["LIFT_LEVEL_TICKS"]
                self.emit("LIFT_LEVELING", "LIFT", "LOW", f"{lid} leveling at Floor {L['target_floor']}")
            elif st == "LEVELING":
                L["floor"] = L["target_floor"]; L["target_floor"] = None; L["y"] = self._elev_of(L["floor"])
                L["state"] = "DOOR_OPENING_AT_DESTINATION" if L["occupant"] else "DOOR_OPENING"
                L["until_tick"] = tick + SIM["LIFT_DOOR_TICKS"]
                self.emit("LIFT_ARRIVED", "LIFT", "INFO", f"{lid} arrived at Floor {L['floor']}")
            elif st == "DOOR_OPENING":
                if L["floor"] == 1: L["door_f1"] = "OPEN"
                else: L["door_f2"] = "OPEN"
                L["state"] = "BOARDING"
                self.emit("LIFT_GATE_OPENED", "LIFT", "LOW", f"{lid} Floor {L['floor']} gate opened")
            elif st == "BOARDING":
                rr = S["robots"].get(L["reserved_by"]) if L["reserved_by"] else None
                if not rr or rr["status"] == "OFFLINE":
                    if L["reserved_by"]:
                        self.release_robot_from_lift(L["reserved_by"])
                    L["door_f1"] = "CLOSED"; L["door_f2"] = "CLOSED"
                    L["state"] = "COOLDOWN"; L["until_tick"] = tick + SIM["LIFT_COOLDOWN_TICKS"]
                    self.emit("LIFT_COOLDOWN_STARTED", "LIFT", "LOW", f"{lid} cooldown")
            elif st == "DOOR_CLOSING":
                L["door_f1"] = "CLOSED"; L["door_f2"] = "CLOSED"
                if L["occupant"]:
                    rr = S["robots"][L["occupant"]]
                    rt = self.rt.get(L["occupant"])
                    dest = rt.pending["floor"] if rt and rt.pending else (2 if rr["floor"] == 1 else 1)
                    L["target_floor"] = dest
                    L["state"] = "MOVING_UP" if dest == 2 else "MOVING_DOWN"
                    L["floor"] = None; L["until_tick"] = tick + SIM["LIFT_TRAVEL_TICKS"]
                    L["trips"] += 1
                    self.emit("LIFT_DEPARTED", "LIFT", "INFO", f"{lid} departed → Floor {dest} ({L['occupant']})", robot_id=L["occupant"])
                else:
                    L["state"] = "COOLDOWN"; L["until_tick"] = tick + SIM["LIFT_COOLDOWN_TICKS"]
                    self.emit("LIFT_COOLDOWN_STARTED", "LIFT", "LOW", f"{lid} cooldown")
            elif st == "DOOR_OPENING_AT_DESTINATION":
                if L["floor"] == 1: L["door_f1"] = "OPEN"
                else: L["door_f2"] = "OPEN"
                L["state"] = "ALIGHTING"
                self.emit("LIFT_GATE_OPENED", "LIFT", "LOW", f"{lid} Floor {L['floor']} gate opened")
            elif st == "DOOR_CLOSING_AFTER_EXIT":
                L["door_f1"] = "CLOSED"; L["door_f2"] = "CLOSED"
                L["state"] = "COOLDOWN"; L["until_tick"] = tick + SIM["LIFT_COOLDOWN_TICKS"]
                self.emit("LIFT_COOLDOWN_STARTED", "LIFT", "LOW", f"{lid} cooldown")
            elif st == "COOLDOWN":
                L["state"] = "IDLE"


    def _handle_lift(self, r: dict[str, Any], rt: RobotRt) -> bool:
        S = self.state; tick = S["sim"]["tick"]
        stage = rt.lift_stage
        if stage is None or stage == "TO_LIFT":
            if rt.target is not None:
                return False
            L = S["lifts"][rt.lift_id]
            if L["fault"]:
                return self._re_route_lift(r, rt)
            f = str(r["floor"])
            if r["id"] not in L["queue"][f]:
                L["queue"][f].append(r["id"]); rt.lift_enqueued_tick = tick
                self.emit("LIFT_QUEUE_ENTERED", "LIFT", "LOW", f"{r['id']} queued at {rt.lift_id} (F{r['floor']}, #{len(L['queue'][f])})", robot_id=r["id"])
            self._set_lift_stage(r, rt, "QUEUED")
            return True
        L = S["lifts"][rt.lift_id]
        lay = self._lift_layout(rt.lift_id)
        if L["fault"] and stage not in ("RIDING", "ALIGHTING"):
            return self._re_route_lift(r, rt)
        if stage == "QUEUED":
            f = str(r["floor"])
            pos = L["queue"][f].index(r["id"]) if r["id"] in L["queue"][f] else -1
            if pos < 0:
                self._set_lift_stage(r, rt, "TO_LIFT"); return True
            # round-9f：遞補走「淨空帶」。從東側/偏離軸線直線切向排隊格，會斜插進登梯走廊，
            # 和 BOARDING 中的隊首形成 OBB 互卡（一個等對方讓位、一個等對方走開，誰都不動）。
            # 規則：x 已對正 → 垂直進格；在軸線上且位於自己格的西側 → 正常沿軸遞補；
            # 其餘先橫向撤離軸線 1.8 m（遠離軸線的步必不被擋）→ 沿淨空帶平行走到格位正側 → 垂直進格。
            slot = self._lift_slot(lay, min(pos, 2))
            dxs = r["position"][0] - slot[0]; dzs = r["position"][2] - slot[1]
            side = 1.0 if dzs >= 0 else -1.0
            if abs(dxs) < 0.25:
                goal = slot
            elif abs(dzs) < 0.25 and dxs < 0.35:
                goal = slot
            elif abs(dzs) > 1.55:
                goal = (slot[0], slot[1] + side * 1.8)
            else:
                goal = (r["position"][0], slot[1] + side * 1.8)
            if rt.lift_queue_goal is None:
                rt.lift_queue_goal = goal
            arrived = self._micro_move(r, rt.lift_queue_goal, SIM["LIFT_QUEUE_SPEED"])
            if arrived:
                rt.lift_queue_goal = None
            if arrived and math.hypot(r["position"][0]-slot[0],r["position"][2]-slot[1]) < 1e-6 and pos == 0 and L["reserved_by"] == r["id"] and L["state"] == "BOARDING" and L["floor"] == r["floor"]:
                self._set_lift_stage(r, rt, "BOARDING")
                self.emit("ROBOT_BOARDING_STARTED", "LIFT", "INFO", f"{r['id']} boarding {rt.lift_id} → Floor {rt.pending['floor']}", robot_id=r["id"])
            return True
        if stage == "BOARDING":
            if self._micro_move(r, self._lift_cabin(lay), SIM["LIFT_BOARD_SPEED"]):
                f = str(r["floor"])
                if r["id"] in L["queue"][f]:
                    L["queue"][f].remove(r["id"])
                L["occupant"] = r["id"]; L["reserved_by"] = None; r["lift_id"] = rt.lift_id
                L["wait_total_ticks"] += tick - rt.lift_enqueued_tick; L["wait_n"] += 1
                L["state"] = "DOOR_CLOSING"; L["until_tick"] = tick + SIM["LIFT_DOOR_TICKS"]
                self._set_lift_stage(r, rt, "RIDING")
                self.emit("ROBOT_BOARDED", "LIFT", "INFO", f"{r['id']} boarded {rt.lift_id}", robot_id=r["id"])
            return True
        if stage == "RIDING":
            r["velocity"] = 0
            c = self._lift_cabin(lay); r["position"][0] = c[0]; r["position"][2] = c[1]
            if L["state"] == "ALIGHTING" and L["floor"] == rt.pending["floor"]:
                # 門已開 → 開始下車。樓層【還不能】翻（規格 §2.2：完全離開轎廂/門區才切換）
                self._set_lift_stage(r, rt, "ALIGHTING")
                self.emit("ROBOT_ALIGHTING_STARTED", "LIFT", "INFO", f"{r['id']} alighting {rt.lift_id} at Floor {L['floor']}", robot_id=r["id"])
            return True
        if stage == "ALIGHTING":
            tf = rt.pending["floor"]   # 出口與間距全用目的樓層計算；r["floor"] 到抵達出口那一刻才翻
            if rt.lift_exit is None:
                rt.lift_exit = self._pick_lift_exit(lay, tf, tuple(rt.pending["point"])); rt.lift_blocked_ticks = 0; rt.lift_exit_phase = None
            gate = self._lift_gate_point(lay)
            # 三階段離梯（round-8d）：轎廂內先原地轉向門 → 沿門軸直行、【真正抵達】轉向安全點（門面 − 對角半徑 − 0.10 m）
            # → 原地旋轉朝出口（速度 0、4.0 rad/s 有限角速度、誤差 < 0.06 rad 才走）→ 前往出口。
            # 位移與旋轉不再同時發生：旋轉掃掠（對角半徑 0.584 m）全程遠離門框，畫面也不會「邊走邊甩」。
            if not rt.lift_exit_phase:
                rt.lift_exit_phase = "TURN_OUT"

            def rotate_to(tx: float, tz: float) -> bool:
                want = math.atan2(tz - r["position"][2], tx - r["position"][0])
                dh = want - r["heading"]
                while dh > math.pi: dh -= 2 * math.pi
                while dh < -math.pi: dh += 2 * math.pi
                r["velocity"] = 0
                r["heading"] += _sign(dh) * min(abs(dh), self.motion.turn_rate_rad_s * SIM["TICK_S"])
                return abs(dh) < 1e-6

            arrived = False
            if rt.lift_exit_phase == "TURN_OUT":
                if rotate_to(gate[0], gate[1]):
                    rt.lift_exit_phase = "OUT"
            elif rt.lift_exit_phase == "OUT":
                if self._micro_move(r, gate, SIM["LIFT_BOARD_SPEED"], tf):
                    rt.lift_exit_phase = "TURN_EXIT"
            elif rt.lift_exit_phase == "TURN_EXIT":
                if rotate_to(rt.lift_exit[0], rt.lift_exit[1]):
                    rt.lift_exit_phase = "GO"
            else:
                arrived = self._micro_move(r, rt.lift_exit, SIM["LIFT_BOARD_SPEED"], tf)
            if not arrived and r["velocity"] == 0 and rt.lift_exit_phase in ("OUT", "GO"):
                rt.lift_blocked_ticks += 1
                if rt.lift_blocked_ticks % 40 == 0:   # 被擋 4 秒換一個出口；換了出口要先轉再走
                    rt.lift_exit = self._pick_lift_exit(lay, tf, tuple(rt.pending["point"]), rt.lift_blocked_ticks // 40)
                    if rt.lift_exit_phase == "GO":
                        rt.lift_exit_phase = "TURN_EXIT"
            elif r["velocity"] > 0:
                rt.lift_blocked_ticks = 0
            if arrived:
                r["floor"] = tf   # ✅ 完全離開門區的這一刻才進入目的樓層網格
                L["occupant"] = None; r["lift_id"] = None
                L["state"] = "DOOR_CLOSING_AFTER_EXIT"; L["until_tick"] = tick + SIM["LIFT_DOOR_TICKS"]
                self.emit("ROBOT_EXITED", "LIFT", "INFO", f"{r['id']} exited {rt.lift_id} on Floor {r['floor']}", robot_id=r["id"])
                p = rt.pending; rt.pending = None; self._set_lift_stage(r, rt, None); rt.lift_id = None
                rt.lift_exit = None; rt.lift_blocked_ticks = 0; rt.lift_exit_phase = None
                self._plan_to(r, rt, tuple(p["point"]), p["phase"], p["loc_id"], p["floor"])
            return True
        return False


    def _re_route_lift(self, r: dict[str, Any], rt: RobotRt) -> bool:
        tick = self.state["sim"]["tick"]
        if tick < rt.lift_retry_tick:
            r["velocity"] = 0; return True
        rt.lift_retry_tick = tick + SIM["LIFT_RETRY_TICKS"]
        p = rt.pending
        self.release_robot_from_lift(r["id"])
        rt.pending = p
        alive = [l for l in self.layout["lifts"] if not self.state["lifts"][l["id"]]["fault"]]
        if not alive:
            r["velocity"] = 0; return True
        self._plan_to(r, rt, tuple(p["point"]), p["phase"], p["loc_id"], p["floor"])
        self.emit("ROUTE_REPLANNED", "LIFT", "MEDIUM", f"{r['id']} rerouted to {rt.lift_id} (lift fault)", robot_id=r["id"])
        return True


    def _lift_approach_eta(self, r, l):
        slot = self._lift_slot(l,0)
        grid = self._robot_grid(r)
        path = astar(grid,to_cell(r["position"][0],r["position"][2]),to_cell(*slot))
        if path is None: return math.inf
        limits = tuple(r["max_speed"]*(.6 if grid.cells[z*grid.cols+x] == 2 else 1) for x,z in path)
        return route_eta(path,0,r["position"],r["heading"],r["velocity"],r["max_speed"],self.motion,limits=limits)

    def lift_cost(self, r: dict[str, Any], l: dict[str, Any]) -> float:
        """電梯成本（規格書 §7.2）：走到電梯 + 排隊估計 + 就位估計；FAULT = inf（與 TS 相同）"""
        L = self.state["lifts"][l["id"]]
        if L["fault"]:
            return math.inf
        slot = self._lift_slot(l,0)
        approach = self._lift_approach_eta(r,l)
        # 預約者上車前仍留在 queue 裡，只有「不在任一 queue」（已離隊上車中）才額外 +1，避免重複計等待成本
        rb = L["reserved_by"]
        reserved_extra = 1 if rb and rb not in L["queue"]["1"] and rb not in L["queue"]["2"] else 0
        queue_len = len(L["queue"]["1"]) + len(L["queue"]["2"]) + reserved_extra
        cabin = self._lift_cabin(l); gate = self._lift_gate_point(l)
        # Free-flow boarding and two exit legs use the same acceleration law.
        manoeuvre = sum(_run_duration((length,),0.,min(SIM["LIFT_BOARD_SPEED"],r["max_speed"]),self.motion,SIM["TICK_S"]) or 0
                       for length in (math.dist(slot,cabin),math.dist(cabin,gate),2.))
        manoeuvre += (math.pi+math.pi/2)/self.motion.turn_rate_rad_s
        per_service = (SIM["LIFT_DOOR_TICKS"] * 4 + SIM["LIFT_TRAVEL_TICKS"] + SIM["LIFT_LEVEL_TICKS"] + SIM["LIFT_COOLDOWN_TICKS"]) * SIM["TICK_S"] + manoeuvre
        busy = 0 if L["state"] == "IDLE" else per_service * 0.5
        wrong_floor = SIM["LIFT_TRAVEL_TICKS"] * SIM["TICK_S"] if (L["floor"] is not None and L["floor"] != r["floor"]) else 0
        return approach + queue_len * per_service + busy + wrong_floor


    def _pick_lift(self, r: dict[str, Any]) -> Optional[dict[str, Any]]:
        c = sorted(({"l": l, "cost": self.lift_cost(r, l)} for l in self.layout["lifts"]), key=lambda x: (x["cost"], x["l"]["id"]))
        return c[0]["l"] if c and c[0]["cost"] < math.inf else None

