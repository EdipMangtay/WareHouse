"""Preserved fleet behaviour, composed by SimEngine; owns no separate state."""
from __future__ import annotations
import math
from typing import Any, Optional
from .astar import NavGrid, astar, can_traverse, cell_center, is_walkable, nearest_walkable, to_cell
from .runtime import TH, SIM, RobotRt, mulberry32, jsround, js_to_fixed0, _sign

class FleetOperations:
    def _generate_tasks(self) -> None:
        S = self.state
        if S["sim"]["tick"] < self.next_task_tick:
            return
        self.next_task_tick = S["sim"]["tick"] + jsround(SIM["TASK_INTERVAL_TICKS"] * (0.5 + self.rng()))
        waiting = sum(1 for t in S["tasks"].values() if t["status"] == "WAITING")
        if not self.layout.get('conveyor_network') and waiting >= SIM["MAX_WAITING_TASKS"]:
            return
        locs = self.layout["locations"]
        shelves = [l for l in locs if l["kind"] == "SHELF"]
        packs = [l for l in locs if l["kind"] in ("PACKING", "SORTING")]
        inbound = [l for l in locs if l["kind"] == "INBOUND"]
        outbound = [l for l in locs if l["kind"] == "OUTBOUND"]

        def pick(a: list) -> Any:
            return a[math.floor(self.rng() * len(a))]

        if self.layout.get('conveyor_network'):
            # Bounded demo work: one pending job per available idle carrier,
            # balanced across home zones. Customer jobs count towards this demand.
            self.next_task_tick = S['sim']['tick'] + 20
            packing=[l for l in packs if l['kind']=='PACKING']
            groups={z:[] for z in ('ZONE_A','ZONE_B','ZONE_C','ZONE_D','SERVICE')}
            for robot in S['robots'].values():
                if robot['fsm']=='IDLE' and robot['battery']>TH['BATTERY_WARNING'] and not robot['current_task_id']:
                    groups[robot.get('home_zone','SERVICE')].append(robot)
            queued={z:0 for z in groups}
            for t in S['tasks'].values():
                if t['status']!='WAITING': continue
                source=self.loc.get(t['source'],{})
                group=source.get('zone') if t['type']=='PICK' and source.get('zone','').startswith('ZONE_') else 'SERVICE'
                if group in queued: queued[group]+=1
            for zone,robots in groups.items():
                if zone!='SERVICE' and S['zones'][zone]['status']=='BLOCKED': continue
                for _ in range(max(0,len(robots)-queued[zone])):
                    if zone=='SERVICE':
                        if packing and 'OUT-01' in self.loc:
                            self.create_task('TRANSPORT','NORMAL',pick(packing)['id'],'OUT-01')
                    else:
                        sources=[l for l in shelves if l['zone']==zone]
                        if sources and packing:
                            self.create_task('PICK','NORMAL',pick(sources)['id'],pick(packing)['id'])
            return
        r = self.rng()
        pr = "HIGH" if r < 0.15 else "CRITICAL" if r < 0.18 else "NORMAL"
        if r < 0.55:
            self.create_task("PICK", pr, pick(shelves)["id"], pick(packs)["id"])
        elif r < 0.8:
            self.create_task("REPLENISH", pr, pick(inbound)["id"], pick(shelves)["id"])
        else:
            self.create_task("TRANSPORT", pr, pick(packs)["id"], pick(outbound)["id"])


    def _assign_tasks(self) -> None:
        S = self.state
        prio_rank = {"CRITICAL": 0, "HIGH": 1, "NORMAL": 2, "LOW": 3}
        waiting = sorted((t for t in S["tasks"].values() if t["status"] == "WAITING"), key=lambda t: (prio_rank[t["priority"]], t["created_tick"]))
        if not waiting:
            return
        idle = [r for r in S["robots"].values() if r["fsm"] == "IDLE" and r["status"] not in ("OFFLINE", "ERROR") and r["battery"] > TH["BATTERY_WARNING"]]
        weights = {"distance": 0.35, "battery": 0.25, "workload": 0.15, "congestion": 0.15, "health": 0.10}
        for task in waiting:
            if not idle:
                return
            src = self.loc.get(task["source"])
            if not src or task['destination'] not in self.loc:
                task['status'] = 'FAILED'; task['completed_tick'] = S['sim']['tick']
                self.emit('TASK_FAILED', 'SIMULATION', 'HIGH', f"Task #{task['id']} failed: unknown source or destination", task_id=task['id'])
                continue
            src_floor = src.get("floor", 1)
            lift_pick: dict[str, str] = {}   # 每台候選當下算出的最佳電梯（round-6 P2：稽核與實際路線綁定）
            cands = []
            for r in idle:
                if self.layout.get('conveyor_network'):
                    required = src['zone'] if task['type']=='PICK' and src['zone'].startswith('ZONE_') else 'SERVICE'
                    if r.get('home_zone') != required: continue
                # 跨樓層：地面距離 + 固定懲罰 + 「實際電梯狀態」的預估等待（排隊長度/忙碌/所在樓層），換算成等效距離
                flat = math.hypot(r["position"][0] - src["access_point"][0], r["position"][2] - src["access_point"][1])
                d = flat; lift_info = None
                if r["floor"] != src_floor:
                    ranked = sorted(({"l": l, "cost": self.lift_cost(r, l)} for l in self.layout["lifts"]), key=lambda x: (x["cost"], x["l"]["id"]))
                    best_l = ranked[0] if ranked else None
                    if best_l and best_l["cost"] < math.inf:
                        approach = self._lift_approach_eta(r,best_l["l"])
                        wait_s = jsround((best_l["cost"] - approach) * 10) / 10
                        lift_info = {"id": best_l["l"]["id"], "waitS": wait_s}
                        lift_pick[r["id"]] = best_l["l"]["id"]
                    else:
                        lift_info = {"id": "—", "waitS": 60}
                    d = flat + SIM["LIFT_XFLOOR_PENALTY_M"] + lift_info["waitS"] * r["max_speed"] * 0.8
                zone = S["zones"].get(r["zone"]) if r["zone"] else None
                cong = zone["congestion"] if zone else 0
                tc = r["stats"]["tasks_completed"]
                workload = "HIGH" if tc > 8 else "MEDIUM" if tc > 4 else "LOW"
                score = (weights["distance"] * (1 - min(1, d / 120)) + weights["battery"] * (r["battery"] / 100)
                         + weights["workload"] * (1 if workload == "LOW" else 0.6 if workload == "MEDIUM" else 0.2)
                         + weights["congestion"] * (1 - cong) + weights["health"] * (r["health"] / 100))
                if lift_info:
                    reasons = [f"{js_to_fixed0(flat)}m ground", f"+{SIM['LIFT_XFLOOR_PENALTY_M']}m cross-floor via {lift_info['id']}",
                               f"est. lift wait {lift_info['waitS']:g}s", f"{js_to_fixed0(r['battery'])}% battery"]
                else:
                    reasons = [f"{js_to_fixed0(d)}m from task", f"{js_to_fixed0(r['battery'])}% battery", f"{workload.lower()} workload"]
                if cong < 0.3:
                    reasons.append("no route congestion")
                cands.append({"robot_id": r["id"], "score": jsround(score * 1000) / 1000, "distance_m": jsround(d), "battery": jsround(r["battery"]),
                              "workload": workload, "congestion": jsround(cong * 100) / 100, "health": r["health"], "reasons": reasons, "rejected_reason": None})
            if not cands: continue
            cands.sort(key=lambda c: -c["score"])
            best = cands[0]
            for c in cands[1:]:
                c["rejected_reason"] = ("battery too low" if c["battery"] < 40 else "farther from task" if c["distance_m"] > best["distance_m"] * 1.5
                                        else "high workload" if c["workload"] == "HIGH" else "lower score")
            robot = S["robots"][best["robot_id"]]
            idle.remove(robot)
            task["status"] = "ASSIGNED"; task["assigned_robot"] = robot["id"]; task["assigned_tick"] = S["sim"]["tick"]
            robot["current_task_id"] = task["id"]
            self.rt[robot["id"]].planned_lift_id = lift_pick.get(robot["id"])   # _plan_to 跨樓層時優先使用稽核記錄的電梯
            self._set_fsm(robot, "TASK_ASSIGNED")
            self.decision_seq += 1
            S["recent_decisions"].insert(0, {"id": f"D{self.decision_seq}", "tick": S["sim"]["tick"], "kind": "TASK_ASSIGNMENT", "task_id": task["id"],
                                             "selected_robot": robot["id"], "candidates": cands[:5], "weights": weights, "narrative": None})
            if len(S["recent_decisions"]) > 50:
                S["recent_decisions"].pop()
            self.emit("TASK_ASSIGNED", "FLEET_MANAGER", "INFO", f"Task #{task['id']} assigned to {robot['id']} ({best['distance_m']}m, {best['battery']}%)", task_id=task["id"], robot_id=robot["id"])


    def _prune_tasks(self) -> None:
        S = self.state; tick = S["sim"]["tick"]
        for tid in [tid for tid, t in S["tasks"].items() if t["status"] in ("COMPLETED", "FAILED", "TRANSFERRED", "CANCELLED") and t["completed_tick"] is not None and tick - t["completed_tick"] > 3000 and not t.get("package_id")]:
            del S["tasks"][tid]


    def _set_fsm(self, r: dict[str, Any], fsm: str) -> None:
        if r["fsm"] == fsm:
            return
        r["fsm"] = fsm; r["fsm_since_tick"] = self.state["sim"]["tick"]
        r["status"] = self._status_of(r)


    @staticmethod
    def _status_of(r: dict[str, Any]) -> str:
        f = r["fsm"]
        if f == "OFFLINE": return "OFFLINE"
        if f == "ERROR": return "ERROR"
        if f == "CHARGING": return "CHARGING"
        if r["battery"] < TH["BATTERY_CRITICAL"]: return "ERROR"
        if r["battery"] < TH["BATTERY_WARNING"]: return "WARNING"
        if f == "IDLE": return "IDLE"
        return "ACTIVE"


    def _step_robot(self, r: dict[str, Any], rt: RobotRt) -> None:
        S = self.state; tick = S["sim"]["tick"]
        if r["fsm"] == "OFFLINE":
            r["velocity"] = 0; return
        self._battery_tick(r, rt)
        task = S["tasks"].get(r["current_task_id"]) if r["current_task_id"] else None
        if rt.pending is not None and self._handle_lift(r, rt):
            r["status"] = self._status_of(r)
            if r["fsm"] not in ("IDLE", "CHARGING"):
                r["stats"]["busy_ticks"] += 1
            r["zone"] = self._zone_at(r["position"][0], r["position"][2], r["floor"])
            return
        f = r["fsm"]
        if f == "IDLE":
            r["velocity"] = 0; rt.idle_ticks += 1
            if r["battery"] < TH["BATTERY_WARNING"] + 15 and self._free_charger(r):
                self._go_charge(r, rt)
            else:
                if rt.idle_ticks > SIM["IDLE_TO_PARK_TICKS"] and not rt.phase and r["floor"] == 1:
                    p = self._park_spot(r)
                    if p:
                        self._plan_to(r, rt, p, "TO_PARK")
                if rt.phase == "TO_PARK":
                    self._move_along_path(r, rt)
                    if rt.target is None and rt.pending is None:
                        rt.phase = None
        elif f == "TASK_ASSIGNED":
            rt.idle_ticks = 0
            if not task:
                self._set_fsm(r, "IDLE")
            else:
                src = self.loc[task["source"]]
                self._plan_to(r, rt, tuple(src["access_point"]), "TO_SOURCE", task["source"])
                task["status"] = "IN_PROGRESS"; task["started_tick"] = tick
                self._set_fsm(r, "NAVIGATING")
        elif f == "NAVIGATING":
            if not task:
                self._set_fsm(r, "IDLE")
            else:
                self._move_along_path(r, rt)
                if rt.target is None and rt.pending is None:
                    rt.dwell = SIM["PICK_TICKS"]; self._set_fsm(r, "PICKING")
                    r.update(operation_duration_ticks=rt.dwell, operation_elapsed_ticks=0)
        elif f == "PICKING":
            r["velocity"] = 0
            rt.dwell -= 1
            r['operation_elapsed_ticks'] = r.get('operation_duration_ticks', SIM['PICK_TICKS']) - rt.dwell
            if rt.dwell <= 0 and task:
                dest = self.loc.get(task.get("handoff_station") or task["destination"])
                if not dest:   # 防禦：任務目的地不存在（正常不會發生，create_task 已驗證）→ 任務失敗、機器人回 IDLE，不能讓迴圈炸掉
                    task["status"] = "FAILED"; task["completed_tick"] = tick
                    self.emit("TASK_FAILED", "SIMULATION", "HIGH", f"Task #{task['id']} failed: unknown destination {task['destination']}", robot_id=r["id"], task_id=task["id"])
                    r["current_task_id"] = None; r["destination"] = None; rt.phase = None; rt.goal_loc = None
                    self._set_fsm(r, "IDLE"); return
                r["load"]["current"] = min(r["load"]["capacity"], task["load_units"])
                self.emit("TASK_STARTED", "ROBOT", "INFO", f"{r['id']} picked item at {self.pretty(task['source'])}", robot_id=r["id"], task_id=task["id"])
                self.conveyor.picked(S, task, r)
                if task.get('package_id') and not self.conveyor.claim_induction(S,task,r):
                    spawn=next(s for s in self.layout['spawn']['robots'] if s['id']==r['id'])
                    self._plan_to(r,rt,(spawn['position'][0],spawn['position'][2]),'TO_INDUCTION_QUEUE')
                else:
                    self._plan_to(r, rt, tuple(dest["access_point"]), "TO_DEST", dest['id'])
                self._set_fsm(r, "TRANSPORTING")
        elif f == "TRANSPORTING":
            if not task:
                self._set_fsm(r, "IDLE")
            else:
                low = False
                if r["battery"] < TH["BATTERY_WARNING"] and rt.last_battery_alert != "CRIT" and not r.get("payload_package_id"):
                    remain = self._remaining_path_length(r)
                    need = remain * (SIM["BATTERY_MOVE"] + SIM["BATTERY_LOAD"]) / (r["max_speed"] * SIM["TICK_S"]) + 3
                    if need > r["battery"] - TH["BATTERY_CRITICAL"]:
                        self._set_fsm(r, "LOW_BATTERY"); low = True
                if not low:
                    self._move_along_path(r, rt)
                    if rt.target is None and rt.pending is None:
                        if rt.phase=='TO_INDUCTION_QUEUE':
                            if self.conveyor.claim_induction(S,task,r):
                                dest=self.loc[task['handoff_station']]
                                self._plan_to(r,rt,tuple(dest['access_point']),'TO_DEST',dest['id'])
                            r['stats']['wait_ticks']+=1
                            return
                        rt.dwell = SIM["DROP_TICKS"] * self._station_slowdown(task["destination"]); self._set_fsm(r, "DELIVERING")
                        r.update(operation_duration_ticks=rt.dwell, operation_elapsed_ticks=0)
        elif f == "DELIVERING":
            r["velocity"] = 0
            if task and task.get('package_id') and not self.conveyor.begin_handoff(S,task,r):
                r['stats']['wait_ticks'] += 1
                return
            rt.dwell -= 1
            r['operation_elapsed_ticks'] = min(r.get('operation_duration_ticks', SIM['DROP_TICKS']), r.get('operation_duration_ticks', SIM['DROP_TICKS']) - rt.dwell)
            if rt.dwell <= 0:
                if task and task.get('package_id'):
                    if not self.conveyor.accept(S, task, r):
                        r['stats']['wait_ticks'] += 1
                        return
                    self.emit('PARCEL_ACCEPTED','CONVEYOR','INFO',f"{task['package_id']} accepted at {task['handoff_station']}",task_id=task['id'],robot_id=r['id'],payload={'package_id':task['package_id']})
                self._complete_task(r, rt)
        elif f == "COMPLETED":
            self._set_fsm(r, "IDLE"); rt.idle_ticks = 0
        elif f == "LOW_BATTERY":
            r["velocity"] = 0; self._set_fsm(r, "TASK_TRANSFER")
        elif f == "TASK_TRANSFER":
            if task:
                task["status"] = "TRANSFERRED"; task["completed_tick"] = tick
                nt = self.create_task(task["type"], "HIGH" if task["priority"] == "NORMAL" else task["priority"], task["source"], task["destination"], task["load_units"], package_id=task.get("package_id"))
                nt["parent_task_id"] = task["id"]
                self.emit("TASK_TRANSFERRED", "FLEET_MANAGER", "MEDIUM", f"{r['id']} low battery — task #{task['id']} re-queued as #{nt['id']}", robot_id=r["id"], task_id=nt["id"])
                r["load"]["current"] = 0; r["current_task_id"] = None
            self._go_charge(r, rt)
        elif f == "GOING_TO_CHARGE":
            self._move_along_path(r, rt)
            if rt.target is None and rt.pending is None:
                self._set_fsm(r, "CHARGING")
                # 入塢對齊（round-9d）：停在自己充電樁的藍色充電板正中央、車頭朝樁 —— 前端補間呈現為入塢動作
                chg = next((c for c in self.layout["charging_stations"] if c["id"] == rt.charger_id), None) if rt.charger_id else None
                if chg and self.layout.get('conveyor_network'):
                    r['heading']=math.atan2(chg['position'][2]-r['position'][2],chg['position'][0]-r['position'][0])
                elif chg:
                    # −1.9 = 停車排整格中心（64.5）：與南側走廊淨距 1.0 m，後車可通行（round-9e 解排隊卡死）
                    r["position"][0] = chg["position"][0]; r["position"][2] = chg["position"][2] - 1.9
                    r["heading"] = math.pi / 2; r["velocity"] = 0
                self.emit("ROBOT_STATE_CHANGED", "ROBOT", "INFO", f"{r['id']} charging started ({js_to_fixed0(r['battery'])}%)", robot_id=r["id"])
        elif f == "CHARGING":
            r["velocity"] = 0
            r["battery"] = min(100, r["battery"] + SIM["CHARGE_RATE"])
            if r["battery"] >= TH["BATTERY_CHARGE_TO"]:
                if rt.charger_id:
                    self.charger_busy[rt.charger_id] = None
                rt.charger_id = None
                rt.last_battery_alert = "NONE"; self._resolve_alert(f"bat-{r['id']}")
                self._set_fsm(r, "IDLE"); rt.idle_ticks = 0
                self.emit("ROBOT_STATE_CHANGED", "ROBOT", "INFO", f"{r['id']} charging complete", robot_id=r["id"])
        elif f == "OBSTACLE_DETECTED":
            self._set_fsm(r, "REPLANNING")
        elif f == "REPLANNING":
            if rt.target:
                p = astar(self._robot_grid(r), to_cell(r["position"][0], r["position"][2]), rt.target, blocked=self._blocked_cells(r["id"], r["floor"]), cost_map=self._congestion_cost(r["floor"]))
                if p is not None:
                    r["path"] = [list(c) for c in p]; r["path_index"] = 0; rt.wait_ticks = 0
                    self.emit("ROUTE_REPLANNED", "PLANNER", "LOW", f"{r['id']} rerouted ({len(p)} cells)", robot_id=r["id"], task_id=r["current_task_id"])
            self._set_fsm(r, "TRANSPORTING" if rt.phase in ("TO_DEST", "TO_INDUCTION_QUEUE") else "GOING_TO_CHARGE" if rt.phase == "TO_CHARGER" else "IDLE" if rt.phase == "TO_PARK" else "NAVIGATING")
        elif f == "ERROR":
            r["velocity"] = 0
        r["status"] = self._status_of(r)
        if r["fsm"] not in ("IDLE", "CHARGING"):
            r["stats"]["busy_ticks"] += 1
        r["zone"] = self._zone_at(r["position"][0], r["position"][2], r["floor"])


    def _complete_task(self, r: dict[str, Any], rt: RobotRt) -> None:
        S = self.state
        task = S["tasks"].get(r["current_task_id"]) if r["current_task_id"] else None
        if task:
            self.conveyor.release_induction(S,task,r)
            task["status"] = "COMPLETED"; task["completed_tick"] = S["sim"]["tick"]
            self.task_times.append(S["sim"]["tick"] - task["created_tick"])
            if len(self.task_times) > 200:
                self.task_times.pop(0)
            self.completed_count += 1
            if task["deadline_tick"] is None or S["sim"]["tick"] <= task["deadline_tick"]:
                self.on_time += 1
            r["stats"]["tasks_completed"] += 1
            self.emit("TASK_COMPLETED", "ROBOT", "INFO", f"{r['id']} completed task #{task['id']} at {self.pretty(task['destination'])}", robot_id=r["id"], task_id=task["id"])
        r["load"]["current"] = 0; r["current_task_id"] = None; r["destination"] = None; rt.phase = None; rt.goal_loc = None
        self._set_fsm(r, "COMPLETED")


    def _battery_tick(self, r: dict[str, Any], rt: RobotRt) -> None:
        if r["fsm"] == "CHARGING":
            return
        moving = r["velocity"] > 0.05
        drain = (SIM["BATTERY_MOVE"] * (r["velocity"] / r["max_speed"]) + (SIM["BATTERY_LOAD"] if r["load"]["current"] > 0 else 0)) if moving else SIM["BATTERY_IDLE"]
        r["battery"] = max(0, r["battery"] - drain)
        r["stats"]["energy_wh"] += drain * 0.5
        b = r["battery"]
        if b < TH["BATTERY_CRITICAL"] and rt.last_battery_alert != "CRIT":
            rt.last_battery_alert = "CRIT"
            self.emit("ROBOT_BATTERY_CRITICAL", "ROBOT", "CRITICAL", f"{r['id']} Battery Critical ({js_to_fixed0(b)}%)", robot_id=r["id"], zone_id=r["zone"])
            self._raise_alert(f"bat-{r['id']}", "CRITICAL", f"{r['id']}  Battery Critical", f"{js_to_fixed0(b)}% remaining", robot_id=r["id"], zone_id=r["zone"])
        elif b < TH["BATTERY_WARNING"] and rt.last_battery_alert == "NONE":
            rt.last_battery_alert = "WARN"
            self.emit("ROBOT_BATTERY_LOW", "ROBOT", "HIGH", f"{r['id']} Battery Low ({js_to_fixed0(b)}%)", robot_id=r["id"], zone_id=r["zone"])
            self._raise_alert(f"bat-{r['id']}", "HIGH", f"{r['id']}  Battery Low", f"{js_to_fixed0(b)}% remaining", robot_id=r["id"], zone_id=r["zone"])
        if b <= 0 and r["fsm"] != "ERROR":
            self._set_fsm(r, "ERROR")
            self.emit("ROBOT_OFFLINE", "ROBOT", "CRITICAL", f"{r['id']} battery depleted — stopped", robot_id=r["id"])


    def _station_slowdown(self, loc_id: str) -> int:
        """供應該工作站的輸送帶故障時，卸貨要等人工處理：停留時間 ×4（Demo 04 的瓶頸來源）"""
        cv = next((c for c in self.layout["conveyors"] if c.get("feeds") == loc_id), None)
        if not cv: return 1
        st = self.state["conveyors"].get(cv["id"], {}).get("status")
        return 4 if st in ("ERROR", "STOPPED") else 2 if st in ("WARNING", "MAINTENANCE") else 1


    def _free_charger(self, r=None) -> Optional[str]:
        for cid, v in self.charger_busy.items():
            if r and r.get('home_zone'):
                zone=next(c['zone'] for c in self.layout['charging_stations'] if c['id']==cid)
                if r['home_zone'].startswith('ZONE_') and zone!=r['home_zone']: continue
                if r['home_zone']=='SERVICE' and zone.startswith('ZONE_'): continue
            if not v:
                return cid
        return None


    def _go_charge(self, r: dict[str, Any], rt: RobotRt) -> None:
        cid = self._free_charger(r)
        if not cid:
            self._set_fsm(r, "IDLE"); return
        c = next(cc for cc in self.layout["charging_stations"] if cc["id"] == cid)
        self.charger_busy[cid] = r["id"]; rt.charger_id = cid
        self._plan_to(r, rt, tuple(c["access_point"]), "TO_CHARGER", cid)
        self._set_fsm(r, "GOING_TO_CHARGE")


    def _park_spot(self, r: dict[str, Any]) -> Optional[tuple[float, float]]:
        if r.get('home_zone','') and r['home_zone'].startswith('ZONE_'):
            spawn=next(s for s in self.layout['spawn']['robots'] if s['id']==r['id'])
            point=(spawn['position'][0],spawn['position'][2])
            return point if math.dist(point,(r['position'][0],r['position'][2]))>1.5 else None
        parks = self.layout["parking"]
        if not parks:
            return None
        p = parks[0]
        i = int("".join(ch for ch in r["id"] if ch.isdigit())) - 1
        x = math.floor(p["rect"][0] + 1 + (i % 10) * 2) + 0.5; z = math.floor(p["rect"][1] + 1 + (i // 10) * 2.2) + 0.5
        if math.hypot(r["position"][0] - x, r["position"][2] - z) < 1.5:
            return None
        return (x, z)

