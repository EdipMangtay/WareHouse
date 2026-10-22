"""Preserved monitoring behaviour, composed by SimEngine; owns no separate state."""
from __future__ import annotations
import math
from typing import Any, Optional
from .astar import NavGrid, astar, can_traverse, cell_center, is_walkable, nearest_walkable, to_cell
from .runtime import TH, SIM, RobotRt, mulberry32, jsround, js_to_fixed0, _sign

class MonitoringOperations:
    def _update_devices(self) -> None:
        S = self.state; robots = list(S["robots"].values()); tick = S["sim"]["tick"]
        for sid, s in S["sensors"].items():
            ls = next((x for x in self.layout["sensors"] if x["id"] == sid), None)
            if not ls or s["status"] == "OFFLINE": continue
            near = sum(1 for r in robots if math.hypot(r["position"][0] - ls["position"][0], r["position"][2] - ls["position"][2]) < 10)
            if s["kind"] == "PRESENCE": s["value"] = 1 if near > 0 else 0; s["unit"] = "bool"
            elif s["kind"] == "LIDAR": s["value"] = near; s["unit"] = "objects"
            elif s["kind"] == "TEMP": s["value"] = jsround((21 + math.sin(tick / 3000) * 1.5) * 10) / 10; s["unit"] = "°C"
            elif s["kind"] == "WEIGHT": cv = S["conveyors"].get("CV03"); s["value"] = cv["items_on_belt"] * 12 if cv else 0; s["unit"] = "kg"
        if self.layout.get("conveyor_network"): return
        for cid, c in S["conveyors"].items():
            lc = next((x for x in self.layout["conveyors"] if x["id"] == cid), None)
            if c["status"] == "RUNNING":
                deliveries = sum(1 for r in robots if r["fsm"] == "DELIVERING" and lc and r["destination"] == lc.get("feeds"))
                c["items_on_belt"] = max(0, min(12, c["items_on_belt"] + deliveries - (1 if tick % 30 == 0 else 0)))
                c["throughput_per_min"] = jsround((2 + c["items_on_belt"] * 0.3) * 10) / 10
            else:
                c["throughput_per_min"] = 0


    def _zone_at(self, x: float, z: float, floor: int = 1) -> Optional[str]:
        for zid, (x0, z0, x1, z1) in self._zone_bounds.items():
            if self._zone_floor.get(zid, 1) != floor:
                continue
            if x0 <= x <= x1 and z0 <= z <= z1:
                return zid
        return None


    def _update_zones(self) -> None:
        S = self.state
        counts: dict[str, int] = {}
        for r in S["robots"].values():
            if r["zone"]:
                counts[r["zone"]] = counts.get(r["zone"], 0) + 1
        for zid, z in S["zones"].items():
            z["robot_count"] = counts.get(zid, 0)
            cap = SIM["ZONE_CAPACITY"] + 2 if self._zone_floor.get(zid, 1) == 2 else SIM["ZONE_CAPACITY"]
            z["congestion"] = min(1, z["robot_count"] / cap)
            if zid in self.blocked_zones:
                z["status"] = "BLOCKED"; continue
            inj = self.congested_zones.get(zid)
            if inj: z["congestion"] = max(z["congestion"], inj["level"])
            was = z["status"]
            z["status"] = "CONGESTED" if z["congestion"] >= TH["CONGESTION_WARNING"] else "NORMAL"
            if z["status"] == "CONGESTED" and was != "CONGESTED":
                self.emit("ZONE_CONGESTION_HIGH", "SIMULATION", "MEDIUM", f"Zone {zid} congestion high ({z['robot_count']} robots)", zone_id=zid)


    def _update_kpi(self) -> None:
        S = self.state; K = S["kpi"]; robots = list(S["robots"].values()); tasks = list(S["tasks"].values()); tick = S["sim"]["tick"]
        K["tick"] = tick
        fleet = {"total": len(robots), "active": 0, "charging": 0, "idle": 0, "warning": 0, "error": 0, "offline": 0}
        for r in robots:
            fleet[r["status"].lower()] += 1
        K["fleet"] = fleet
        win = 3000
        recent = sum(1 for t in tasks if t["status"] == "COMPLETED" and t["completed_tick"] is not None and tick - t["completed_tick"] < win)
        K["operation"] = {
            "throughput_per_min": jsround((recent / min(5, max(1, tick / 600))) * 10) / 10,
            "completed_today": self.completed_count, "completed_target": 150,
            "pending": sum(1 for t in tasks if t["status"] == "WAITING"),
            "ongoing": sum(1 for t in tasks if t["status"] in ("ASSIGNED", "IN_PROGRESS")),
            "avg_task_time_s": jsround((sum(self.task_times) / len(self.task_times)) * SIM["TICK_S"]) if self.task_times else 0,
            "on_time_rate": (self.on_time / self.completed_count) if self.completed_count else 1,
            "avg_utilization": (sum(r["stats"]["busy_ticks"] for r in robots) / (len(robots) * tick)) if tick else 0,
        }
        cong = sum(z["congestion"] for z in S["zones"].values()) / max(1, len(S["zones"]))
        K["efficiency"] = {
            "avg_travel_distance_m": jsround(sum(r["stats"]["distance_m"] for r in robots) / max(1, self.completed_count)),
            "avg_wait_time_s": jsround((sum(r["stats"]["wait_ticks"] for r in robots) / len(robots)) * SIM["TICK_S"]),
            "congestion_index": jsround(cong * 100) / 100,
            "energy_kwh": jsround(sum(r["stats"]["energy_wh"] for r in robots)) / 1000,
        }
        lifts = list(S["lifts"].values())
        wait_n = sum(l["wait_n"] for l in lifts)
        K["lifts"] = {
            "trips": sum(l["trips"] for l in lifts),
            "utilization": round(sum(l["busy_ticks"] for l in lifts) / (len(lifts) * S["sim"]["tick"]), 3) if S["sim"]["tick"] and lifts else 0,
            "avg_wait_s": round(sum(l["wait_total_ticks"] for l in lifts) / wait_n * SIM["TICK_S"], 1) if wait_n else 0,
            "faults": sum(1 for l in lifts if l["fault"]),
        }
        S["subsystems"]["CHARGING"] = "WARNING" if all(self.charger_busy.values()) else "NORMAL"
        cvs = S["conveyors"].values()
        S["subsystems"]["CONVEYORS"] = "ERROR" if any(c["status"] == "ERROR" for c in cvs) else "WARNING" if any(c["status"] != "RUNNING" for c in cvs) else "NORMAL"
        S["subsystems"]["WAREHOUSE"] = "WARNING" if self.blocked_zones else "NORMAL"


    def _push_series(self) -> None:
        S = self.state; self.last_series_tick = S["sim"]["tick"]
        S["kpi"]["throughput_series"].append({"tick": S["sim"]["tick"], "completed": self.completed_count, "target": jsround(S["sim"]["tick"] / 600 * 1.25)})
        if len(S["kpi"]["throughput_series"]) > TH["THROUGHPUT_SERIES_SIZE"]:
            S["kpi"]["throughput_series"].pop(0)


    def emit(self, type_: str, source: str, severity: str, message: str, **rel: Any) -> dict[str, Any]:
        self.event_seq += 1
        ev = {"id": f"E{self.event_seq}", "tick": self.state["sim"]["tick"], "type": type_, "source": source, "severity": severity, "message": message}
        for k, v in rel.items():
            if v is not None:
                ev[k] = v
        self.state["recent_events"].insert(0, ev)
        if len(self.state["recent_events"]) > SIM["EVENT_RING"]:
            self.state["recent_events"].pop()
        self.new_events.append(ev)
        return ev


    def _raise_alert(self, aid: str, severity: str, title: str, detail: str, **rel: Any) -> None:
        ev = self.state["recent_events"][0] if self.state["recent_events"] else None
        a = {"id": aid, "created_tick": self.state["sim"]["tick"], "severity": severity, "title": title, "detail": detail,
             "source_event_id": ev["id"] if ev else "", "acknowledged": False, "resolved_tick": None}
        for k, v in rel.items():
            if v is not None:
                a[k] = v
        self.state["alerts"][aid] = a


    def _resolve_alert(self, aid: str) -> None:
        self.state["alerts"].pop(aid, None)


    def _apply_injections(self) -> None:
        S = self.state; now = S["sim"]["tick"]; keep = []
        for inj in self.pending_injections:
            if inj.get("at_tick") is not None and inj["at_tick"] > now:
                keep.append(inj); continue
            k = inj["kind"]
            if k == "ROBOT_FAILURE":
                r = S["robots"].get(inj["robot_id"])
                if r:
                    self._set_fsm(r, "OFFLINE"); r["velocity"] = 0
                    t = S["tasks"].get(r["current_task_id"]) if r["current_task_id"] else None
                    if t and r.get('payload_package_id'):
                        self.emit('ROBOT_OFFLINE','USER','CRITICAL',f"{r['id']} offline with parcel held; restore robot to resume",robot_id=r['id'])
                        continue
                    if t:
                        t["status"] = "TRANSFERRED"; t["completed_tick"] = now
                        nt = self.create_task(t["type"], "HIGH", t["source"], t["destination"], t["load_units"], package_id=t.get("package_id")); nt["parent_task_id"] = t["id"]
                    r["current_task_id"] = None; r["path"] = []
                    self.release_robot_from_lift(r["id"]); self.rt[r["id"]].pending = None
                    self.emit("ROBOT_OFFLINE", "USER", "CRITICAL", f"{r['id']} failure injected — OFFLINE", robot_id=r["id"])
                    self._raise_alert(f"off-{r['id']}", "CRITICAL", f"{r['id']}  Offline", "Robot failure", robot_id=r["id"])
            elif k == "ROBOT_BATTERY_SET":
                r = S["robots"].get(inj["robot_id"])
                if r:
                    r["battery"] = inj["battery"]; self.rt[r["id"]].last_battery_alert = "NONE"
            elif k == "CONVEYOR_FAILURE":
                c = S["conveyors"].get(inj["conveyor_id"])
                if c:
                    c["status"] = "ERROR"; c["speed_mps"] = 0
                    self.emit("CONVEYOR_STATUS_CHANGED", "CONVEYOR", "HIGH", f"{inj['conveyor_id']} failure — STOPPED", conveyor_id=c["id"])
                    self._raise_alert(f"cv-{c['id']}", "HIGH", f"Conveyor {c['id']}  Error", "Throughput impact: HIGH", conveyor_id=c["id"])
            elif k == "CAMERA_OFFLINE":
                c = S["cameras"].get(inj["camera_id"])
                if c:
                    c["status"] = "OFFLINE"; S["subsystems"]["CCTV"] = "WARNING"
                    self.emit("CAMERA_STATUS_CHANGED", "CAMERA", "MEDIUM", f"{c['id']} offline", camera_id=c["id"])
            elif k == "HUMAN_INTRUSION":
                zid = inj["zone_id"]; b = self._zone_bounds.get(zid)
                if b:
                    x0, z0, x1, z1 = b
                    pid = f"H-{zid}-{now}"
                    S["people"][pid] = {"id": pid, "kind": "WORKER", "position": [(x0 + x1) / 2, 0, z0 + 6.3], "heading": 0, "zone": zid, "floor": self._zone_floor.get(zid, 1), "expires_tick": now + inj["duration_ticks"]}
                    self.blocked_zones.add(zid); S["zones"][zid]["blocked_reason"] = "Human detected"; S["zones"][zid]["blocked_since_tick"] = now
                    self.emit("HUMAN_DETECTED", "VLM", "HIGH", f"Human detected — Zone {zid}", zone_id=zid)
                    self.emit("ZONE_BLOCKED", "SIMULATION", "HIGH", f"Zone {zid} marked BLOCKED", zone_id=zid)
                    self._raise_alert(f"zone-{zid}", "HIGH", f"Zone {zid}  Human Detected", "Route blocked", zone_id=zid)
                    for r in S["robots"].values():
                        if r["path"] and any(x0 <= c[0] < x1 and z0 <= c[1] < z1 for c in r["path"][r["path_index"]:]):
                            self._set_fsm(r, "OBSTACLE_DETECTED")
            elif k == "TRAFFIC_CONGESTION":
                zid = inj["zone_id"]
                self.congested_zones[zid] = {"level": inj["level"], "until": now + inj["duration_ticks"]}
                self.emit("ZONE_CONGESTION_HIGH", "USER", "MEDIUM", f"Traffic congestion injected — Zone {zid} (level {jsround(inj['level'] * 100)}%)", zone_id=zid)
                self._raise_alert(f"traffic-{zid}", "MEDIUM", f"Zone {zid}  Traffic Delay", f"Speed limited to {jsround((1 - 0.7 * inj['level']) * 100)}%", zone_id=zid)
                for r in S["robots"].values():
                    if len(r["path"]) > r["path_index"] + 3 and r["fsm"] != "IDLE": self._set_fsm(r, "OBSTACLE_DETECTED")
            elif k == "TASK_BURST":
                for _ in range(inj["count"]):
                    self.next_task_tick = now; self._generate_tasks()
            elif k == "LIFT_FAULT":
                L = S["lifts"].get(inj["lift_id"])
                if L and not L["fault"]:
                    L["fault"] = True
                    L["fault_remaining"] = max(0, L["until_tick"] - now)   # 凍結計時器：解除時從剩餘進度續跑，平台不瞬移
                    self.emit("LIFT_FAULT", "LIFT", "CRITICAL" if L["occupant"] else "HIGH",
                              f"{inj['lift_id']} FAULT" + (f" — {L['occupant']} inside, platform stalled" if L["occupant"] else ""),
                              robot_id=L["occupant"])
                    self._raise_alert(f"lift-{inj['lift_id']}", "CRITICAL" if L["occupant"] else "HIGH", f"{inj['lift_id']}  Fault",
                                      f"Platform stalled with {L['occupant']} aboard" if L["occupant"] else "Out of service")
        self.pending_injections = keep
        for zid in [z for z, cz in self.congested_zones.items() if now >= cz["until"]]:
            del self.congested_zones[zid]; self._resolve_alert(f"traffic-{zid}")
            self.emit("ZONE_UNBLOCKED", "SIMULATION", "INFO", f"Zone {zid} traffic back to normal", zone_id=zid)
        for pid in list(S["people"].keys()):
            p = S["people"][pid]
            if p["expires_tick"] is not None and now >= p["expires_tick"]:
                del S["people"][pid]
                z = p["zone"]
                if z and not any(q["zone"] == z for q in S["people"].values()):
                    self.blocked_zones.discard(z); S["zones"][z]["blocked_reason"] = None; S["zones"][z]["blocked_since_tick"] = None
                    self._resolve_alert(f"zone-{z}")
                    self.emit("HUMAN_CLEARED", "VLM", "INFO", f"Zone {z} clear", zone_id=z)
                    self.emit("ZONE_UNBLOCKED", "SIMULATION", "INFO", f"Zone {z} unblocked", zone_id=z)

