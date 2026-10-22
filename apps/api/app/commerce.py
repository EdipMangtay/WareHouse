"""Durable, local-development commerce orchestration over the warehouse engine.

One process owns the engine. SQLite transactions reserve stock and idempotency keys;
warehouse jobs are an outbox dispatched on simulation ticks. This is not a payment
processor or a public, authenticated shop. No city or drone delivery is simulated.
"""
from __future__ import annotations

import hashlib
import json
import math
import resource
import sqlite3
import sys
import time
import uuid
from collections import deque
from datetime import datetime, timezone
from typing import Any, Literal

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


class OrderItem(BaseModel):
    model_config = ConfigDict(extra="forbid")
    product_id: str = Field(min_length=1, max_length=64)
    quantity: int = Field(ge=1, le=20, strict=True)


class Checkout(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    customer_name: str = Field(min_length=2, max_length=100)
    email: str = Field(min_length=5, max_length=200)
    address: str = Field(min_length=5, max_length=500)
    delivery_method: Literal["standard", "express", "pickup"] = "standard"
    items: list[OrderItem] = Field(min_length=1, max_length=20)
    idempotency_key: str = Field(min_length=8, max_length=128)

    @field_validator("email")
    @classmethod
    def valid_email(cls, value: str) -> str:
        if " " in value or value.count("@") != 1 or "." not in value.split("@")[-1]:
            raise ValueError("Geçerli bir e-posta adresi girin")
        return value


class StressRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    rate_per_minute: Literal[5, 100, 500, 1000]
    duration_seconds: int = Field(default=60, ge=10, le=300, strict=True)


CATALOG = [
    ("WT-001", "Kablosuz Kulaklık", "Elektronik", "Gürültü azaltma özellikli günlük kullanım kulaklığı.", 249900, .24, "headphones"),
    ("WT-002", "Akıllı Saat", "Elektronik", "Aktivite takibi ve bildirimler için akıllı saat.", 329900, .12, "watch"),
    ("WT-003", "Mekanik Klavye", "Elektronik", "Kompakt tasarım ve hassas mekanik tuşlar.", 189900, .85, "keyboard"),
    ("WT-004", "Termos", "Yaşam", "Gün boyu sıcak ve soğuk içecekler için 500 ml termos.", 64900, .35, "bottle"),
    ("WT-005", "Sırt Çantası", "Aksesuar", "Dizüstü bilgisayar bölmeli şehir çantası.", 129900, .65, "backpack"),
    ("WT-006", "Masa Lambası", "Ev & Ofis", "Ayarlanabilir ışıklı çalışma masası lambası.", 89900, 1.2, "lamp"),
    ("WT-007", "Bluetooth Hoparlör", "Elektronik", "Taşınabilir, kompakt kablosuz hoparlör.", 159900, .55, "speaker"),
    ("WT-008", "Not Defteri Seti", "Ev & Ofis", "Üçlü çizgili defter ve kalem seti.", 34900, .4, "notebook"),
]


from warehouse_core.legacy.order_flow import OrderFlow

class Commerce(OrderFlow):
    MAX_ACTIVE = 1500
    MAX_DISPATCHED = 120

    def __init__(self, db_path: str, engine: Any):
        self.conn = sqlite3.connect(db_path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.executescript("""
        CREATE TABLE IF NOT EXISTS commerce_products(id TEXT PRIMARY KEY, data TEXT NOT NULL, stock INTEGER NOT NULL CHECK(stock >= 0));
        CREATE TABLE IF NOT EXISTS commerce_orders(id TEXT PRIMARY KEY, tracking_code TEXT UNIQUE NOT NULL,
            idempotency_key TEXT UNIQUE NOT NULL, fingerprint TEXT NOT NULL, status TEXT NOT NULL,
            created_at TEXT NOT NULL, data TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS commerce_order_status ON commerce_orders(status,created_at);
        CREATE TABLE IF NOT EXISTS commerce_stress(id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL);
        """)
        self.engine = engine
        self.stations = [l["id"] for l in engine.layout["locations"] if l["kind"] == "PACKING"]
        self.outbound = [l["id"] for l in engine.layout["locations"] if l["kind"] == "OUTBOUND"][0]
        shelves = [l["id"] for l in engine.layout["locations"] if l["kind"] == "SHELF"]
        if engine.layout.get('conveyor_network'):
            # Seed the shop across all four sectors, retaining deterministic aliases.
            by_zone={z:[l['id'] for l in engine.layout['locations'] if l['kind']=='SHELF' and l['zone']==z] for z in ('ZONE_A','ZONE_B','ZONE_C','ZONE_D')}
            shelves=[by_zone[z][i%len(by_zone[z])] for i in range(2) for z in by_zone]
        with self.conn:
            for i, (pid, name, cat, desc, price, weight, image) in enumerate(CATALOG):
                data = dict(id=pid, name=name, category=cat, description=desc, price_cents=price,
                            weight_kg=weight, image_key=image, rack_id=shelves[i % len(shelves)])
                self.conn.execute("INSERT OR IGNORE INTO commerce_products VALUES(?,?,?)", (pid, json.dumps(data), 250))
            # A smaller/new layout may not contain an older product's storage alias.
            # Move only its physical assignment; prices, stock and order identity stay intact.
            for i, row in enumerate(self.conn.execute("SELECT id, data FROM commerce_products ORDER BY id").fetchall()):
                product = json.loads(row["data"])
                if product["rack_id"] not in shelves:
                    product["rack_id"] = shelves[i % len(shelves)]
                    self.conn.execute("UPDATE commerce_products SET data=? WHERE id=?", (json.dumps(product), row["id"]))
        self.api_samples: deque[float] = deque(maxlen=200)
        self.db_samples: deque[float] = deque(maxlen=200)
        self.history: deque[dict] = deque(maxlen=120)
        self.last_history = 0.0
        self.cpu_time, self.wall_time = time.process_time(), time.monotonic()
        self.cpu_percent = 0.0
        row = self.conn.execute("SELECT data FROM commerce_stress WHERE id=1").fetchone()
        self.stress = json.loads(row[0]) if row else dict(running=False, rate_per_minute=0, created=0, failed=0, remaining_seconds=0)
        self.stress["running"] = False
        self.stress["remaining_seconds"] = 0
        self.stress_end = self.stress_next = 0.0
        self.last_advance_tick = -1
        self.recover(engine)

    def products(self) -> list[dict]:
        return [dict(json.loads(row["data"]), stock=row["stock"]) for row in self.conn.execute("SELECT * FROM commerce_products ORDER BY id")]

    def _save(self, order: dict) -> None:
        order["updated_at"] = utcnow()
        self.conn.execute("UPDATE commerce_orders SET status=?,data=? WHERE id=?", (order["status"], json.dumps(order, ensure_ascii=False), order["id"]))

    def _event(self, order: dict, status: str, message: str) -> None:
        order["status"] = status
        order["events"].append(dict(status=status, message=message, at=utcnow(), tick=self.engine.state["sim"]["tick"]))
        order["events"] = order["events"][-100:]
        order["simulation_elapsed_seconds"] = order.get("elapsed_base", 0) + max(0, self.engine.state["sim"]["tick"] - order["created_tick"]) / 10
        self._save(order)

    def checkout(self, body: Checkout, source: str = "customer") -> dict:
        started = time.perf_counter()
        quantities: dict[str, int] = {}
        for item in body.items:
            quantities[item.product_id] = quantities.get(item.product_id, 0) + item.quantity
        if sum(quantities.values()) > 40:
            raise HTTPException(422, "Bir siparişte en fazla 40 ürün olabilir")
        normalized = body.model_dump(exclude={"idempotency_key", "items"})
        normalized.update(items=sorted(quantities.items()), source=source)
        fingerprint = hashlib.sha256(json.dumps(normalized, sort_keys=True).encode()).hexdigest()
        try:
            self.conn.execute("BEGIN IMMEDIATE")
            old = self.conn.execute("SELECT * FROM commerce_orders WHERE idempotency_key=?", (body.idempotency_key,)).fetchone()
            if old:
                if old["fingerprint"] != fingerprint:
                    raise HTTPException(409, "Bu işlem anahtarı farklı bir sipariş için kullanıldı")
                self.conn.commit()
                return json.loads(old["data"])
            count = self.conn.execute("SELECT count(*) FROM commerce_orders WHERE status!='ready'").fetchone()[0]
            if count >= self.MAX_ACTIVE:
                raise HTTPException(429, "Depo sipariş kuyruğu dolu; lütfen daha sonra deneyin")
            items = []
            for pid, qty in quantities.items():
                row = self.conn.execute("SELECT * FROM commerce_products WHERE id=?", (pid,)).fetchone()
                if not row:
                    raise HTTPException(404, "Ürün bulunamadı: " + pid)
                p = json.loads(row["data"])
                if source != "stress":
                    changed = self.conn.execute("UPDATE commerce_products SET stock=stock-? WHERE id=? AND stock>=?", (qty, pid, qty))
                    if not changed.rowcount:
                        raise HTTPException(409, p["name"] + " için yeterli stok yok")
                items.append(dict(product_id=pid, name=p["name"], quantity=qty, unit_price_cents=p["price_cents"], rack_id=p["rack_id"], weight_kg=p["weight_kg"]))
            total_weight = round(sum(i["quantity"] * i["weight_kg"] for i in items), 2)
            units = sum(i["quantity"] for i in items)
            vehicle = "pickup" if body.delivery_method == "pickup" else "motorcycle" if total_weight <= 3 and units <= 4 else "car" if total_weight <= 12 and units <= 12 else "van" if total_weight <= 40 else "truck"
            dispatch_plan = dict(vehicle_type=vehicle, total_weight_kg=total_weight, total_units=units,
                                 basis="Ağırlık ve ürün adedine dayalı örnek kapasite kuralı; adres rotası ve ürün hacmi henüz modellenmiyor.",
                                 simulated_delivery=False)
            now = utcnow()
            subtotal = sum(i["quantity"] * i["unit_price_cents"] for i in items)
            fee = {"pickup": 0, "standard": 4990, "express": 9990}[body.delivery_method]
            order = dict(id=uuid.uuid4().hex, tracking_code="WT-" + uuid.uuid4().hex[:16].upper(), customer_name=body.customer_name,
                         email=body.email, address=body.address, delivery_method=body.delivery_method, items=items,
                         dispatch_plan=dispatch_plan, subtotal_cents=subtotal, shipping_cents=fee, total_cents=subtotal + fee, status="received", source=source,
                         created_at=now, updated_at=now, created_tick=self.engine.state["sim"]["tick"],
                         estimated_ready_seconds=180 + count * 10, estimate_is_approximate=True,
                         simulation_elapsed_seconds=0, elapsed_base=0, task_ids=[], robot_ids=[], jobs=[],
                         packing_station=None, packing_until_tick=None,
                         events=[dict(status="received", message="Sipariş alındı; depo hazırlık kuyruğunda.", at=now)])
            self.conn.execute("INSERT INTO commerce_orders VALUES(?,?,?,?,?,?,?)", (order["id"], order["tracking_code"], body.idempotency_key, fingerprint, "received", now, json.dumps(order, ensure_ascii=False)))
            self.conn.commit()
            return order
        except Exception:
            self.conn.rollback()
            raise
        finally:
            self.db_samples.append((time.perf_counter() - started) * 1000)

    def get_order(self, code: str) -> dict:
        row = self.conn.execute("SELECT data FROM commerce_orders WHERE tracking_code=?", (code.strip().upper(),)).fetchone()
        if not row:
            raise HTTPException(404, "Takip koduna ait sipariş bulunamadı")
        order = json.loads(row[0])
        live_task_ids = {job["task_id"] for job in order["jobs"] if not job["done"]} if order["status"] in ("picking", "loading") else set()
        order["robot_positions"] = [dict(id=r["id"], position=r["position"], floor=r["floor"], status=r["status"])
                                    for r in self.engine.state["robots"].values()
                                    if r["current_task_id"] in live_task_ids]
        order["current_location"] = {"received": "Depo sipariş kuyruğu", "picking": "Raflar → paketleme alanı",
                                     "packing": order["packing_station"], "loading": "Paketleme → çıkış alanı",
                                     "ready": self.outbound}[order["status"]]
        live = [p for p in self.engine.state.get('packages',{}).values() if p['order_id']==order['id']]
        order['parcels'] = live or order.get('parcels',[])
        return order

    def active(self) -> list[dict]:
        return [json.loads(r[0]) for r in self.conn.execute("SELECT data FROM commerce_orders WHERE status!='ready' ORDER BY created_at")]

    def recover(self, engine: Any) -> None:
        self.engine = engine
        self.last_advance_tick = -1
        with self.conn:
            shelves = {loc["id"] for loc in engine.layout["locations"] if loc["kind"] == "SHELF"}
            products = {p["id"]: p for p in self.products()}
            for order in self.active():
                for item in order["items"]:
                    if item["rack_id"] not in shelves:
                        item["rack_id"] = products[item["product_id"]]["rack_id"]
                order["elapsed_base"] = order.get("simulation_elapsed_seconds", 0)
                order["created_tick"] = engine.state["sim"]["tick"]
                order.update(jobs=[], task_ids=[], robot_ids=[], packing_station=None, packing_until_tick=None)
                self._event(order, "received", "Simülasyon yeniden başlatıldı; ayrılan stok korunarak depo işleri yeniden kuyruğa alındı.")




    def _save_stress(self) -> None:
        with self.conn:
            self.conn.execute("INSERT OR REPLACE INTO commerce_stress VALUES(1,?)", (json.dumps(self.stress),))

    def start_stress(self, req: StressRequest) -> dict:
        if self.stress["running"]:
            raise HTTPException(409, "Bir stres testi zaten çalışıyor")
        self.stress = dict(running=True, rate_per_minute=req.rate_per_minute, created=0, failed=0,
                           remaining_seconds=req.duration_seconds, duration_seconds=req.duration_seconds,
                           started_at=utcnow(), run_id=uuid.uuid4().hex, source="internal_generator", stock_mode="unlimited_test_inventory",
                           elapsed_seconds=0, achieved_rate_per_minute=0)
        self.stress_next = time.monotonic()
        self.stress_end = self.stress_next + req.duration_seconds
        self._save_stress()
        return self.stress

    def stop_stress(self) -> dict:
        if self.stress["running"]:
            self._stress_measurement(time.monotonic())
        self.stress["running"] = False
        self.stress["remaining_seconds"] = 0
        self._save_stress()
        return self.stress

    def _stress_measurement(self, now: float) -> None:
        started = self.stress_end - self.stress.get("duration_seconds", 0)
        elapsed = max(0, now - started)
        self.stress["elapsed_seconds"] = round(elapsed, 3)
        self.stress["achieved_rate_per_minute"] = round(self.stress["created"] * 60 / elapsed, 2) if elapsed > 0 else 0

    def advance_stress(self) -> None:
        if not self.stress["running"]:
            return
        now = time.monotonic()
        generated = 0
        while self.stress_next < self.stress_end and self.stress_next <= now and generated < 5:
            seq = self.stress["created"] + self.stress["failed"]
            body = Checkout(customer_name="Stres Testi", email="stress@example.test", address="Sanal test teslim noktası",
                            items=[OrderItem(product_id=CATALOG[seq % len(CATALOG)][0], quantity=1)],
                            idempotency_key=f"stress-{self.stress['run_id']}-{seq}")
            try:
                self.checkout(body, source="stress")
                self.stress["created"] += 1
            except HTTPException:
                self.stress["failed"] += 1
            generated += 1
            self.stress_next += 60 / self.stress["rate_per_minute"]
        self.stress["remaining_seconds"] = max(0, math.ceil(self.stress_end - now))
        self._stress_measurement(now)
        if now >= self.stress_end and self.stress_next >= self.stress_end:
            self.stress["running"] = False
        if generated or not self.stress["running"]:
            self._save_stress()

    def admin(self) -> dict:
        started = time.perf_counter()
        rows = self.conn.execute("SELECT data FROM commerce_orders ORDER BY created_at DESC LIMIT 250").fetchall()
        counts = dict(self.conn.execute("SELECT status,count(*) FROM commerce_orders GROUP BY status").fetchall())
        # SQLite JSON extraction avoids loading every historical order in Python.
        avg = self.conn.execute("SELECT avg(json_extract(data,'$.simulation_elapsed_seconds')) FROM commerce_orders WHERE status='ready'").fetchone()[0] or 0
        packing_busy = self.conn.execute("SELECT count(*) FROM commerce_orders WHERE status='packing' AND json_extract(data,'$.packing_until_tick') IS NOT NULL").fetchone()[0]
        self.db_samples.append((time.perf_counter() - started) * 1000)
        robots = list(self.engine.state["robots"].values())
        utilization = sum(bool(r["current_task_id"]) for r in robots) / max(1, len(robots))
        metrics = dict(total_orders=sum(counts.values()), active_orders=sum(n for s, n in counts.items() if s != "ready"),
                       ready_orders=counts.get("ready", 0), avg_preparation_seconds=round(avg, 1), robot_utilization=round(utilization, 3),
                       queue_depth=counts.get("received", 0), packing_busy=packing_busy, packing_capacity=len(self.stations),
                       packing_queue=max(0, counts.get("packing", 0)-packing_busy), status_counts=counts)
        now = time.monotonic()
        if now - self.wall_time >= .5:
            cpu = time.process_time()
            self.cpu_percent = max(0, (cpu-self.cpu_time)/(now-self.wall_time)*100)
            self.cpu_time, self.wall_time = cpu, now
        rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / (1024*1024 if sys.platform == "darwin" else 1024)
        perf = dict(api_latency_ms=round(sum(self.api_samples)/max(1, len(self.api_samples)), 2),
                    db_latency_ms=round(sum(self.db_samples)/max(1, len(self.db_samples)), 2), cpu_percent=round(self.cpu_percent, 1),
                    memory_mb=round(rss, 1), memory_kind="process_peak_rss", api_sample_count=len(self.api_samples),
                    measurement="process CPU; peak RSS; mean commerce HTTP response-start latency; mean measured commerce DB operations")
        if now - self.last_history >= 1:
            self.last_history = now
            self.history.append(dict(at=utcnow(), **metrics, **perf))
        return dict(orders=[json.loads(r[0]) for r in rows], orders_limit=250, metrics=metrics, stress=self.stress,
                    performance=perf, history=list(self.history), mode="local_development", authenticated=False,
                    scope="warehouse_only", stress_note="Sunucu içi gerçek sipariş üretimi; HTTP yük testi değildir. Test siparişleri müşteri stoklarını azaltmaz.")
