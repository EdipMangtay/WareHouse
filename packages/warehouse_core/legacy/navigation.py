"""Preserved navigation behaviour, composed by SimEngine; owns no separate state."""
from __future__ import annotations
import math
from typing import Any, Optional
from .astar import NavGrid, astar, can_traverse, cell_center, is_walkable, nearest_walkable, to_cell
from .runtime import TH, SIM, RobotRt, mulberry32, jsround, js_to_fixed0, _sign
from .motion import angle_delta, advance_speed, stopping_distance, route_eta

class NavigationOperations:
    def _robot_grid(self, r):
        base=self.grids[r['floor']]
        zid=r.get('home_zone')
        if not zid or not zid.startswith('ZONE_'): return base
        if not hasattr(self,'_zone_grids'): self._zone_grids={}
        if zid not in self._zone_grids:
            cells=bytearray(base.cells)
            x0,z0,x1,z1=self._zone_bounds[zid]
            for z in range(base.rows):
                for x in range(base.cols):
                    if not (x0<=x+.5<x1 and z0<=z+.5<z1): cells[z*base.cols+x]=1
            self._zone_grids[zid]=NavGrid(base.cols,base.rows,cells,base.cell_size,base.outgoing)
        grid=self._zone_grids[zid]
        grid.hard_blocked=base.hard_blocked;grid.blocked_edges=base.blocked_edges
        return grid


    def _free_service_cell(self, r: dict[str, Any], point: tuple[float, float]) -> Optional[tuple[int, int]]:
        """工作站/貨架的服務格：access point 周圍可走、且沒被其他機器人當目標或佔用的格，挑離自己最近的；都滿了回傳 None"""
        grid = self._robot_grid(r)
        ap = nearest_walkable(grid, point[0], point[1])
        claimed: set[tuple[int, int]] = set()
        for rid, o in self.state["robots"].items():
            if rid == r["id"] or o["floor"] != r["floor"]:
                continue
            t = self.rt[rid].target
            if t: claimed.add((t[0], t[1]))
            claimed.add(to_cell(o["position"][0], o["position"][2]))
        my = to_cell(r["position"][0], r["position"][2])
        best: Optional[tuple[int, int]] = None; best_d = math.inf
        R = SIM["SERVICE_RADIUS"]
        for dr in range(-R, R + 1):
            for dc in range(-R, R + 1):
                c = (ap[0] + dc, ap[1] + dr)
                if not is_walkable(grid, c[0], c[1]) or c in claimed:
                    continue
                d = math.hypot(c[0] - my[0], c[1] - my[1]) + math.hypot(dc, dr) * 0.01
                if d < best_d:
                    best_d = d; best = c
        return best


    def _plan_to(self, r: dict[str, Any], rt: RobotRt, point: tuple[float, float], phase: str, loc_id: Optional[str] = None, target_floor: Optional[int] = None) -> None:
        tf = target_floor if target_floor is not None else (self.loc[loc_id].get("floor", 1) if loc_id and loc_id in self.loc else r["floor"])
        if tf != r["floor"]:
            # 跨樓層（規格書 §7）：Origin → 排隊格（A*）→ 電梯狀態機 → 目的樓層重新規劃
            # 派工時稽核記錄了哪座電梯就優先用哪座（只有它已 FAULT 才重挑），用完即清（round-6 P2）
            preferred = None
            if rt.planned_lift_id:
                pl = next((l for l in self.layout["lifts"] if l["id"] == rt.planned_lift_id), None)
                if pl is not None and not self.state["lifts"][pl["id"]]["fault"]:
                    preferred = pl
            rt.planned_lift_id = None
            lift = preferred or self._pick_lift(r)
            rt.pending = {"point": point, "phase": phase, "loc_id": loc_id, "floor": tf}
            if lift is None:   # 全部故障：原地等，定期重試
                rt.lift_id = self.layout["lifts"][0]["id"] if self.layout["lifts"] else None
                self._set_lift_stage(r, rt, "TO_LIFT")
                rt.target = None; r["path"] = []; r["path_index"] = 0
                rt.lift_retry_tick = self.state["sim"]["tick"] + SIM["LIFT_RETRY_TICKS"]
                return
            rt.lift_id = lift["id"]
            self._set_lift_stage(r, rt, "TO_LIFT")
            self.emit("LIFT_REQUESTED", "LIFT", "LOW", f"{r['id']} requested {lift['id']} (F{r['floor']} → F{tf})", robot_id=r["id"])
            L = self.state["lifts"][lift["id"]]
            slot_idx = min(len(L["queue"][str(r["floor"])]), 2)
            sp = self._lift_slot(lift, slot_idx)
            start = to_cell(r["position"][0], r["position"][2])
            goal = (math.floor(sp[0]), math.floor(sp[1]))
            grid = self._robot_grid(r)
            path = astar(grid, start, goal, blocked=self._blocked_cells(r["id"], r["floor"]), cost_map=self._congestion_cost(r["floor"]))
            if path is None:
                path = astar(grid, start, goal)
            if path is None:
                path = []
            r["path"] = [list(c) for c in path]; r["path_index"] = 0
            rt.target = goal; rt.phase = phase; rt.goal_loc = loc_id; rt.wait_ticks = 0; rt.backing_off = False; rt.resume_point = None
            r["destination"] = loc_id

            self._update_eta(r)
            return
        start = to_cell(r["position"][0], r["position"][2])
        grid = self._robot_grid(r)
        # TO_CHARGER 不用服務格（round-9d）：服務格會讓機器人散落在充電樁旁任意空格 —— 充電要直達自己那一樁的入口格
        goal = (self._free_service_cell(r, point) if loc_id and phase != "TO_CHARGER" and self.loc[loc_id]["kind"] != "INDUCTION" else None) or nearest_walkable(grid, point[0], point[1])
        path = astar(grid, start, goal, blocked=self._blocked_cells(r["id"], r["floor"]), cost_map=self._congestion_cost(r["floor"]))
        if path is None:
            path = astar(grid, start, goal)
        if path is None:
            path = []
        r["path"] = [list(c) for c in path]; r["path_index"] = 0
        rt.target = goal; rt.phase = phase; rt.goal_loc = loc_id; rt.wait_ticks = 0; rt.backing_off = False; rt.resume_point = None
        r["destination"] = loc_id

        self._update_eta(r)


    def _move_along_path(self, r: dict[str, Any], rt: RobotRt) -> None:
        if rt.target is None:
            return
        if r["path_index"] >= len(r["path"]):
            here=to_cell(r['position'][0],r['position'][2])
            if here != rt.target or not is_walkable(self._robot_grid(r),*rt.target):
                r['velocity']=0;rt.wait_ticks+=1
                if rt.wait_ticks % 10 == 1:
                    path=astar(self._robot_grid(r),here,rt.target,blocked=self._blocked_cells(r['id'],r['floor']))
                    if path is not None: r['path']=[list(c) for c in path];r['path_index']=0
                return
            rt.target = None; r["velocity"] = 0; r["path"] = []; r["path_index"] = 0; return
        nxt = r["path"][r["path_index"]]
        ncell = (nxt[0], nxt[1])
        tx, tz = cell_center(ncell)
        pos = r["position"]
        dx = tx - pos[0]; dz = tz - pos[2]
        dist = math.hypot(dx, dz)
        if dist < 1e-8:
            r['path_index'] += 1
            return
        fl = r["floor"]
        occ = self.occupancy.get((fl, ncell[0], ncell[1]))
        my_cell = to_cell(pos[0], pos[2])
        entering = my_cell != ncell
        grid=self._robot_grid(r)
        if not is_walkable(grid,*ncell) or (entering and not can_traverse(grid,my_cell,ncell)):
            r['velocity']=0;rt.wait_ticks+=1
            if rt.wait_ticks % 10 == 1:
                path=astar(grid,my_cell,rt.target,blocked=self._blocked_cells(r['id'],fl))
                if path is not None: r['path']=[list(c) for c in path];r['path_index']=0
            return
        if entering and not occ and ncell[0] != my_cell[0] and ncell[1] != my_cell[1]:
            a = self.occupancy.get((fl, ncell[0], my_cell[1])); b = self.occupancy.get((fl, my_cell[0], ncell[1]))
            if a and a != r["id"]: occ = a
            elif b and b != r["id"]: occ = b
        # 感知層：接下來路徑上 < PERC_STOP 有動態障礙也視為被擋（比格子預約早一格停，車身不再貼在一起）
        blocked_by = occ if (entering and occ and occ != r["id"]) else None
        perc_stop = rt.front_id is not None and rt.front_dist < SIM["PERC_STOP"]
        if not blocked_by and perc_stop:
            blocked_by = rt.front_id
        if blocked_by:
            occ = blocked_by
            # 前往電梯途中在大廳口被排隊的機器人擋住：直接視為到達，入隊後由排隊邏輯遞補
            if rt.lift_stage == "TO_LIFT" and len(r["path"]) - r["path_index"] <= 2:
                rt.target = None; r["velocity"] = 0; r["path"] = []; r["path_index"] = 0; rt.wait_ticks = 0; return
            if perc_stop and r["perception"]["state"] != "STOPPED":
                r["perception"]["state"] = "STOPPED"
                if self.state["sim"]["tick"] - rt.last_perc_event > SIM["PERC_EVENT_TICKS"] and rt.front_id and rt.front_id in self.state["robots"]:
                    rt.last_perc_event = self.state["sim"]["tick"]
                    self.emit("OBSTACLE_DETECTED", "ROBOT", "LOW", f"{r['id']} LiDAR: {rt.front_id} ahead {rt.front_dist:.1f} m — holding", robot_id=r["id"])
            remaining0 = len(r["path"]) - r["path_index"]
            # 工作站前排隊：距目標 ≤ N 格就視為到達、就地作業
            if not rt.backing_off and remaining0 <= SIM["STATION_ARRIVE_CELLS"] and rt.phase in ("TO_SOURCE", "TO_DEST") and self.loc.get(rt.goal_loc, {}).get("kind") != "INDUCTION":
                # 先找另一個空的服務格（每台一格，不會疊在一起）；真的都滿了才就地作業
                loc = self.loc.get(rt.goal_loc) if rt.goal_loc else None
                alt = self._free_service_cell(r, tuple(loc["access_point"])) if loc else None
                if alt and rt.target and (alt[0] != rt.target[0] or alt[1] != rt.target[1]):
                    p = astar(self._robot_grid(r), my_cell, alt, blocked=self._blocked_cells(r["id"], fl))
                    if p:
                        r["path"] = [list(c) for c in p]; r["path_index"] = 0; rt.target = alt; rt.wait_ticks = 0; return
                rt.target = None; r["velocity"] = 0; r["path"] = []; r["path_index"] = 0; r["eta_s"] = 0; rt.wait_ticks = 0; return
            r["velocity"] = 0  # A blocked movement performs an actual safety stop.
            rt.wait_ticks += 1; r["stats"]["wait_ticks"] += 1
            other = self.state["robots"].get(occ)
            mutual = bool(other) and ((other["path_index"] < len(other["path"]) and tuple(other["path"][other["path_index"]]) == my_cell) or self.rt[other["id"]].front_id == r["id"])
            if mutual and rt.wait_ticks > 10 and self._yields_to(r, other):
                self._back_off(r, rt); return
            if rt.wait_ticks == SIM["WAIT_REPLAN_TICKS"]:
                self.emit("OBSTACLE_DETECTED", "ROBOT", "LOW", f"{r['id']} blocked by {occ} — replanning", robot_id=r["id"])
                self._set_fsm(r, "OBSTACLE_DETECTED")
            elif rt.wait_ticks >= SIM["WAIT_BACKOFF_TICKS"]:
                self._back_off(r, rt)
            return
        # 注意：wait_ticks 不在這裡歸零 —— 要等「真的移動了」才歸零（round-8b）。
        # 否則純物理間距擋停（下方 MIN_SEP 檢查）每 tick 被重設成 1，永遠到不了 back-off 門檻，
        # 兩台在窄走道 0.9 m 對峙就永久卡死。
        if entering:
            self.occupancy[(fl, ncell[0], ncell[1])] = r["id"]   # 立刻預約下一格
            if ncell[0] != my_cell[0] and ncell[1] != my_cell[1]:   # 斜向：兩個正交鄰格也預約
                for k in ((fl, ncell[0], my_cell[1]), (fl, my_cell[0], ncell[1])):
                    if k not in self.occupancy: self.occupancy[k] = r["id"]
        desired = math.atan2(dz, dx)
        # A yielding robot may reverse along a legal edge. Forcing a half-turn
        # while two bodies are close can make both robots unable to retreat.
        if rt.backing_off and abs(angle_delta(desired + math.pi, r["heading"])) < abs(angle_delta(desired, r["heading"])):
            desired += math.pi
        dh = desired - r["heading"]
        while dh > math.pi: dh -= 2 * math.pi
        while dh < -math.pi: dh += 2 * math.pi
        # Align on the cleared route before translating: rotating while moving
        # along a different vector produced sideways sliding in narrow aisles.
        if abs(dh) > 1e-6:
            next_heading = r['heading'] + max(-self.motion.turn_rate_rad_s * SIM['TICK_S'], min(self.motion.turn_rate_rad_s * SIM['TICK_S'], dh))
            if any(o['id'] != r['id'] and o['floor'] == fl and self.obb_overlap(pos[0], pos[2], next_heading, o['position'][0], o['position'][2], o['heading'], .05) for o in self.state['robots'].values()):
                r['velocity'] = 0; rt.wait_ticks += 1
                if rt.wait_ticks >= SIM['WAIT_BACKOFF_TICKS']: self._back_off(r, rt)
                return
            r['heading'] = next_heading
            r['velocity'] = 0
            return
        walk = self.grids[fl].cells[ncell[1] * self.grid.cols + ncell[0]] == 2
        slowing = rt.front_id is not None and rt.front_dist < SIM["PERC_SLOW"]
        if slowing:
            r["perception"]["state"] = "SLOWING"
        vmax = r["max_speed"] * (0.6 if walk else 1) * (self._zone_speed_factor(ncell, fl) if self.congested_zones else 1) * (0.45 if slowing else 1)
        stop_distance = stopping_distance(r['path'], r['path_index'], pos[0], pos[2])
        r['velocity'] = advance_speed(r['velocity'], vmax, stop_distance, self.motion, SIM['TICK_S'])
        step_len = min(dist, r["velocity"] * SIM["TICK_S"])
        # Finish the last sub-millimetres without asymptotic target jitter.
        if stop_distance < self.motion.deceleration_mps2 * SIM['TICK_S']**2 / 2 and r['velocity'] <= self.motion.deceleration_mps2 * SIM['TICK_S']:
            step_len = dist
        if dist > 1e-6:
            nx = pos[0] + (dx / dist) * step_len; nz = pos[2] + (dz / dist) * step_len
            # 物理防撞：這一步會讓我跟某台「更靠近」且（中心距 < MIN_SEP 或旋轉車體 OBB 相交 +5cm）→ 不走（round-9b 補 OBB）
            for oid, o in self.state["robots"].items():
                if oid == r["id"] or o["floor"] != fl:
                    continue
                dn = math.hypot(nx - o["position"][0], nz - o["position"][2])
                dcur = math.hypot(pos[0] - o["position"][0], pos[2] - o["position"][2])
                hit = dn < dcur and (dn < SIM["MIN_SEP"] or (dn < 1.5 and self.obb_overlap(nx, nz, r["heading"], o["position"][0], o["position"][2], o["heading"], 0.05)))
                if hit:
                    r["velocity"] = 0; rt.wait_ticks += 1; r["stats"]["wait_ticks"] += 1
                    if rt.wait_ticks >= SIM["WAIT_BACKOFF_TICKS"]:
                        self._back_off(r, rt)
                    return
            pos[0] = nx; pos[2] = nz
            rt.wait_ticks = 0   # 真的動了才算解除阻塞
        r["stats"]["distance_m"] += step_len
        # 交通熱圖（每樓一份）
        T = self.traffic.get(fl); TS_ = self.traffic_short.get(fl)
        if T is not None:
            ci = my_cell[1] * self.grid.cols + my_cell[0]
            if 0 <= ci < len(T):
                T[ci] += 1; TS_[ci] += 1
        if dist - step_len < 1e-8:
            pos[0] = tx; pos[2] = tz
            if stop_distance - dist < 1e-8:
                r['velocity'] = 0
            r["path_index"] += 1
            self.occupancy[(fl, ncell[0], ncell[1])] = r["id"]
            if r["path_index"] >= len(r["path"]):
                rt.target = None; r["velocity"] = 0; r["path"] = []; r["path_index"] = 0; r["eta_s"] = 0
                if rt.backing_off and rt.resume_point:
                    rp = rt.resume_point; rt.backing_off = False; rt.resume_point = None
                    # round-9b：TO_LIFT 途中讓路後的恢復規劃沿用原本的電梯（除非它故障）——
                    # 否則 _plan_to 的跨樓分支會重擲電梯選擇，破壞「派工稽核 = 實際電梯」的一致性
                    if rt.lift_stage == "TO_LIFT" and rt.lift_id and not self.state["lifts"].get(rt.lift_id, {}).get("fault"):
                        rt.planned_lift_id = rt.lift_id
                    self._plan_to(r, rt, rp, rt.phase or "TO_SOURCE", rt.goal_loc)
        if self.state["sim"]["tick"] % 10 == 0:
            self._update_eta(r)


    @staticmethod
    def _yields_to(me: dict[str, Any], other: dict[str, Any]) -> bool:
        """誰讓路：空車讓載貨車；都一樣時編號大的讓"""
        if (me["load"]["current"] > 0) != (other["load"]["current"] > 0):
            return me["load"]["current"] == 0
        return me["id"] > other["id"]


    def _back_off(self, r: dict[str, Any], rt: RobotRt) -> None:
        """讓路：走到附近一個沒人要經過的空格，之後回到原目標重新規劃"""
        if rt.target is None:
            rt.wait_ticks = 0; return
        my = to_cell(r["position"][0], r["position"][2])
        claimed: set[tuple[int, int]] = set()
        for o in self.state["robots"].values():
            if o["id"] == r["id"] or o["floor"] != r["floor"]: continue
            claimed.add(to_cell(o["position"][0], o["position"][2]))
            for c in o["path"][o["path_index"]:o["path_index"] + 4]:
                claimed.add((c[0], c[1]))
        best = None; best_path = None; best_d = math.inf
        grid = self._robot_grid(r)
        neighbours = [o for o in self.state["robots"].values() if o["id"] != r["id"] and o["floor"] == r["floor"]]
        for dr in range(-3, 4):
            for dc in range(-3, 4):
                if not dr and not dc: continue
                c = (my[0] + dc, my[1] + dr)
                if not is_walkable(grid, c[0], c[1]) or c in claimed: continue
                d = abs(dr) + abs(dc)
                if d >= best_d: continue
                p = astar(grid, my, c, blocked=claimed)
                if not p: continue
                tx, tz = cell_center(p[0])
                direction = math.atan2(tz-r["position"][2], tx-r["position"][0])
                facing = min((direction, direction+math.pi), key=lambda h: abs(angle_delta(h,r["heading"])))
                turn = angle_delta(facing,r["heading"])
                # Check the entire turn, not just its first frame. Keep every
                # candidate on the navigation graph and outside other bodies.
                count = max(1,math.ceil(abs(turn)/(self.motion.turn_rate_rad_s*SIM["TICK_S"])))
                if any(self.obb_overlap(r["position"][0],r["position"][2],r["heading"]+turn*i/count,
                                        o["position"][0],o["position"][2],o["heading"],.05)
                       for o in neighbours for i in range(1,count+1)):
                    continue
                if any(math.hypot(c[0]+.5-o["position"][0],c[1]+.5-o["position"][2]) < SIM["MIN_SEP"] for o in neighbours):
                    continue
                best_d = d; best = c; best_path = p
        rt.wait_ticks = 0
        if best is None: return
        if not rt.backing_off:
            rt.resume_point = cell_center(rt.target)
        rt.backing_off = True; rt.target = best
        r["path"] = [list(c) for c in best_path]; r["path_index"] = 0
        self.emit("ROBOT_COLLISION_AVOIDED", "PLANNER", "LOW", f"{r['id']} yields (back-off {len(best_path)} cells)", robot_id=r["id"])


    def _remaining_path_length(self, r: dict[str, Any]) -> float:
        length = 0.0; px, pz = r["position"][0], r["position"][2]
        for i in range(r["path_index"], len(r["path"])):
            cx, cz = cell_center((r["path"][i][0], r["path"][i][1]))
            length += math.hypot(cx - px, cz - pz); px, pz = cx, cz
        return length


    def _update_eta(self, r: dict[str, Any]) -> None:
        grid = self.grids[r["floor"]]
        limits = tuple(r["max_speed"] * (.6 if grid.cells[z*grid.cols+x] == 2 else 1) *
                       (self._zone_speed_factor((x,z),r["floor"]) if self.congested_zones else 1)
                       for x,z in r["path"][r["path_index"]:])
        r['eta_s'] = route_eta(r['path'], r['path_index'], r['position'], r['heading'], r['velocity'], r['max_speed'], self.motion,
                              limits=limits,reverse=self.rt[r["id"]].backing_off) if r['path'] else None


    def _line_of_sight(self, grid: NavGrid, x0: float, z0: float, x1: float, z1: float) -> bool:
        d = math.hypot(x1 - x0, z1 - z0); n = max(1, math.ceil(d / 0.5))
        for i in range(1, n):
            t = i / n
            c = to_cell(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t)
            if not is_walkable(grid, c[0], c[1]):
                return False
        return True


    def _update_perception(self, r: dict[str, Any], rt: RobotRt) -> None:
        P = r["perception"]
        if r["fsm"] == "OFFLINE":
            P["state"] = "OFF"; P["obstacles"] = []; P["nearest_m"] = None; P["ahead_m"] = 0
            rt.front_id = None; rt.front_dist = math.inf; return
        x, z = r["position"][0], r["position"][2]; h = r["heading"]; cos_h = math.cos(h); sin_h = math.sin(h)
        grid = self._robot_grid(r)
        obs: list[dict[str, Any]] = []

        def consider(kind: str, oid: str, ox: float, oz: float) -> None:
            dx = ox - x; dz = oz - z; dist = math.hypot(dx, dz)
            if dist > SIM["LIDAR_RANGE"] or dist < 1e-6:
                return
            b = math.atan2(dz, dx) - h
            while b > math.pi: b -= 2 * math.pi
            while b < -math.pi: b += 2 * math.pi
            if abs(b) > SIM["LIDAR_FOV"] / 2:
                return
            if not self._line_of_sight(grid, x, z, ox, oz):
                return
            obs.append({"kind": kind, "id": oid, "distance_m": jsround(dist * 10) / 10, "bearing_deg": jsround(-b * 180 / math.pi)})

        for oid, o in self.state["robots"].items():
            if oid != r["id"] and o["floor"] == r["floor"]:
                consider("ROBOT", oid, o["position"][0], o["position"][2])
        for pid, p in self.state["people"].items():
            if p.get("floor", 1) == r["floor"]:
                consider("HUMAN", pid, p["position"][0], p["position"][2])
        ahead = SIM["LIDAR_RANGE"]
        d = 0.5
        while d <= SIM["LIDAR_RANGE"] + 1e-9:
            c = to_cell(x + cos_h * d, z + sin_h * d)
            if not is_walkable(grid, c[0], c[1]):
                ahead = d; break
            d += 0.25
        if ahead < SIM["LIDAR_RANGE"]:
            obs.append({"kind": "RACK", "id": None, "distance_m": jsround(ahead * 10) / 10, "bearing_deg": 0})
        obs.sort(key=lambda o: (o["distance_m"], o["id"] or ""))
        front_id: Optional[str] = None; front_dist = math.inf
        if r["path_index"] < len(r["path"]):
            on_path: set[tuple[int, int]] = set(); prev = to_cell(x, z)
            for i in range(r["path_index"], min(len(r["path"]), r["path_index"] + SIM["PERC_LOOKAHEAD"])):
                c = (r["path"][i][0], r["path"][i][1]); on_path.add(c)
                if c[0] != prev[0] and c[1] != prev[1]:
                    on_path.add((c[0], prev[1])); on_path.add((prev[0], c[1]))
                prev = c
            for o in obs:
                if o["kind"] == "RACK" or o["id"] is None:
                    continue
                pos = self.state["robots"][o["id"]]["position"] if o["kind"] == "ROBOT" else self.state["people"][o["id"]]["position"]
                if to_cell(pos[0], pos[2]) in on_path and o["distance_m"] < front_dist:
                    front_dist = o["distance_m"]; front_id = o["id"]
        rt.front_id = front_id; rt.front_dist = front_dist
        P["obstacles"] = obs[:5]
        P["nearest_m"] = obs[0]["distance_m"] if obs else None
        P["ahead_m"] = jsround(min(ahead, front_dist if front_id else ahead) * 10) / 10
        P["state"] = "CLEAR"


    def _rebuild_occupancy(self) -> None:
        self.occupancy.clear()
        for rid, r in self.state["robots"].items():
            fl = r["floor"]
            c = to_cell(r["position"][0], r["position"][2]); self.occupancy[(fl, c[0], c[1])] = rid
            if r["path_index"] < len(r["path"]):
                n = (fl, r["path"][r["path_index"]][0], r["path"][r["path_index"]][1])
                if n not in self.occupancy:
                    self.occupancy[n] = rid
                if n[1] != c[0] and n[2] != c[1]:   # 斜向：正交鄰格一起預約
                    for k in ((fl, n[1], c[1]), (fl, c[0], n[2])):
                        if k not in self.occupancy: self.occupancy[k] = rid


    def _sync_navigation(self) -> None:
        stamp = tuple(sorted(self.blocked_zones))
        if stamp == self._navigation_zone_stamp: return
        for floor, grid in self.grids.items():
            blocked = set(self.navigation_blocks[floor])
            for zone in self.layout['zones']:
                if zone['id'] not in self.blocked_zones or zone.get('floor',1) != floor: continue
                xs=[p[0] for p in zone['polygon']];zs=[p[1] for p in zone['polygon']]
                for z in range(max(0,math.floor(min(zs))),min(grid.rows,math.ceil(max(zs)))):
                    for x in range(max(0,math.floor(min(xs))),min(grid.cols,math.ceil(max(xs)))):
                        blocked.add((x,z))
            grid.hard_blocked = blocked
        self._navigation_zone_stamp=stamp
        self.navigation_revision += 1


    def change_navigation(self, floor: int, cells: list, edges: list, blocked: bool, bidirectional: bool=True) -> None:
        if floor not in self.grids: raise ValueError('Unknown floor')
        grid=self.grids[floor]
        def cell(value):
            if len(value)!=2 or any(type(v) is not int for v in value): raise ValueError('Cells must contain two integers')
            x,z=value
            if not 0<=x<grid.cols or not 0<=z<grid.rows or grid.cells[z*grid.cols+x]==1: raise ValueError('Cell is outside navigable space')
            return (x,z)
        checked=[cell(c) for c in cells]
        pairs=[]
        static_grid=NavGrid(grid.cols,grid.rows,grid.cells,grid.cell_size,grid.outgoing)
        for edge in edges:
            if len(edge)!=2: raise ValueError('Edge requires two cells')
            a,b=cell(edge[0]),cell(edge[1])
            if not 0<max(abs(a[0]-b[0]),abs(a[1]-b[1]))<=1: raise ValueError('Edge endpoints must be adjacent')
            if not can_traverse(static_grid,a,b): raise ValueError('Edge is not part of the static navigation graph')
            pairs.append((a,b))
            if bidirectional and can_traverse(static_grid,b,a): pairs.append((b,a))
        if blocked:
            occupied={to_cell(r['position'][0],r['position'][2]) for r in self.state['robots'].values() if r['floor']==floor}
            if occupied.intersection(checked): raise ValueError('Cannot close a cell occupied by a robot')
        # All inputs are checked before the first mutation.
        for c in checked:
            (self.navigation_blocks[floor].add if blocked else self.navigation_blocks[floor].discard)(c)
        for edge in pairs:
            (grid.blocked_edges.add if blocked else grid.blocked_edges.discard)(edge)
        self._navigation_zone_stamp=None
        self._sync_navigation()


    def _blocked_cells(self, self_id: str, floor: int) -> set[tuple[int, int]]:
        s = {(k[1], k[2]) for k, v in self.occupancy.items() if v != self_id and k[0] == floor}
        for zid in self.blocked_zones:
            z = next((zz for zz in self.layout["zones"] if zz["id"] == zid), None)
            if not z or z.get("floor", 1) != floor:
                continue
            b = self._zone_bounds.get(zid)
            if not b: continue
            x0, z0, x1, z1 = b
            for c in range(math.floor(x0), math.floor(x1)):
                for r in range(math.floor(z0), math.floor(z1)):
                    s.add((c, r))
        return s


    def _congestion_cost(self, floor: int = 1) -> Optional[list[float]]:
        """該樓層的交通熱圖當額外成本（round-5 修正：每樓一份）；注入的擁塞 zone 只加在同樓層"""
        T = self.traffic.get(floor)
        if T is None:
            return None
        mx = max(T) if T else 0
        zones_on_floor = [zid for zid in self.congested_zones if self._zone_floor.get(zid, 1) == floor]
        if mx < 1 and not zones_on_floor:
            return None
        out = [t * (0.8 / mx) for t in T] if mx >= 1 else [0.0] * len(T)
        for zid in zones_on_floor:
            cz = self.congested_zones[zid]
            b = self._zone_bounds.get(zid)
            if not b: continue
            x0, z0, x1, z1 = b; add = 3 * cz["level"]; cols = self.grid.cols
            for rr in range(math.floor(z0), math.ceil(z1)):
                base = rr * cols
                for c in range(math.floor(x0), math.ceil(x1)):
                    out[base + c] += add
        return out


    def _zone_speed_factor(self, cell: tuple[int, int], floor: int) -> float:
        for zid, cz in self.congested_zones.items():
            z = next((zz for zz in self.layout["zones"] if zz["id"] == zid), None)
            if not z or z.get("floor", 1) != floor:
                continue
            b = self._zone_bounds.get(zid)
            if b and b[0] <= cell[0] < b[2] and b[1] <= cell[1] < b[3]:
                return 1 - 0.7 * cz["level"]
        return 1.0


    def _decay_traffic(self) -> None:
        if self.state["sim"]["tick"] % 5 == 0:
            for f in self.traffic:
                self.traffic[f] = [t * 0.9985 for t in self.traffic[f]]
                self.traffic_short[f] = [t * 0.975 for t in self.traffic_short[f]]

