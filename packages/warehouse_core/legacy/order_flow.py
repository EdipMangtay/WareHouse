"""Commerce operation transitions; persistence hooks supplied by the API adapter.

Uses active(), _save(), _event(), conn transaction context and a legacy SimEngine.
This compatibility model is deliberately separate from the research order model.
"""
class OrderFlow:
    def _job(self, order: dict, kind: str, source: str, dest: str, qty: int, package_id: str | None = None) -> dict:
        task = self.engine.create_task(kind, "HIGH" if order["delivery_method"] == "express" else "NORMAL", source, dest, qty, order_id=order["id"], package_id=package_id or f"PKG-{order['tracking_code'][3:]}-{len(order['task_ids'])+1:03d}")
        order["task_ids"].append(task["id"])
        return dict(task_id=task["id"], kind=kind, source=source, destination=dest, quantity=qty, package_id=task.get("package_id"), done=False)


    def _sync_jobs(self, order: dict, tasks: dict) -> bool:
        changed = False
        children = {t["parent_task_id"]: t for t in tasks.values() if t.get("parent_task_id")}
        for job in order["jobs"]:
            if job["done"]:
                continue
            task = tasks.get(job["task_id"])
            while task and task["status"] == "TRANSFERRED" and task["id"] in children:
                task = children[task["id"]]
                job["task_id"] = task["id"]
                order["task_ids"].append(task["id"])
                changed = True
            if not task or task["status"] in ("FAILED", "CANCELLED"):
                replacement = self._job(order, job["kind"], job["source"], job["destination"], job["quantity"], job.get("package_id"))
                job.update(replacement)
                changed = True
                continue
            rid = task.get("assigned_robot")
            if rid and rid not in order["robot_ids"]:
                order["robot_ids"].append(rid)
                changed = True
            if task["status"] == "COMPLETED" and (not task.get('package_id') or self.engine.state['packages'][task['package_id']]['status']=='DELIVERED'):
                job["done"] = True
                changed = True
        return changed


    def advance(self) -> None:
        tick = self.engine.state["sim"]["tick"]
        if tick - self.last_advance_tick < 5:
            return
        self.last_advance_tick = tick
        active = self.active()
        occupied = {o["packing_station"] for o in active if o["status"] == "packing" and o["packing_until_tick"] is not None}
        dispatched = sum(o["status"] != "received" for o in active)
        tasks = self.engine.state["tasks"]
        with self.conn:
            for order in active:
                status = order["status"]
                if status == "received" and dispatched < self.MAX_DISPATCHED:
                    station_load = {s: sum(o["packing_station"] == s for o in active if o["status"] != "received") for s in self.stations}
                    station = min(station_load, key=station_load.get)
                    if self.engine.layout.get('conveyor_network'):
                        candidates=sorted(station_load,key=station_load.get)
                        station=next((s for s in candidates if self.engine.conveyor.reserve_station(self.engine.state,s,order['id'],sum(i['quantity'] for i in order['items']))),None)
                        if station is None: continue
                    order["packing_station"] = station
                    for item in order["items"]:
                        batch=1 if self.engine.layout.get('conveyor_network') else 4
                        for offset in range(0, item["quantity"], batch):
                            order["jobs"].append(self._job(order, "PICK", item["rack_id"], order["packing_station"], min(batch, item["quantity"] - offset)))
                    self._event(order, "picking", "Robot görevleri oluşturuldu; ürünler raflardan paketleme alanına taşınıyor.")
                    dispatched += 1
                elif status in ("picking", "loading"):
                    changed = self._sync_jobs(order, tasks)
                    order['parcels']=[p.copy() for p in self.engine.state.get('packages',{}).values() if p['order_id']==order['id']]
                    if all(j["done"] for j in order["jobs"]):
                        if status == "picking":
                            self._event(order, "packing", "Ürünler paketleme alanında; istasyon sırası bekleniyor.")
                        else:
                            self._event(order, "ready", "Paket çıkış alanına ulaştı. Depodan teslim alınmaya / taşıyıcıya devre hazır; son teslimat simüle edilmedi.")
                    elif changed:
                        self._save(order)
                elif status == "packing":
                    station = order["packing_station"]
                    if order["packing_until_tick"] is None and station not in occupied:
                        order["packing_until_tick"] = tick + 120 + 20 * sum(i["quantity"] for i in order["items"])
                        occupied.add(station)
                        self._event(order, "packing", f"{station} istasyonunda paketleme başladı.")
                    elif order["packing_until_tick"] is not None and tick >= order["packing_until_tick"]:
                        occupied.discard(station)
                        if self.engine.layout.get('conveyor_network'):
                            self.engine.conveyor.release_order(self.engine.state,order['id'],station)
                        # Each transport respects the engine robot's four-unit capacity.
                        quantity = sum(i["quantity"] for i in order["items"])
                        order["jobs"] = [self._job(order, "TRANSPORT", station, self.outbound, min(4, quantity-offset)) for offset in range(0, quantity, 4)]
                        self._event(order, "loading", "Paketleme tamamlandı; paketler çıkış konveyörüne aktarılıyor.")

