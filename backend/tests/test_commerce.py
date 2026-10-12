"""Commerce invariants and integration with the actual robot simulation."""
import uuid

import pytest
from fastapi import HTTPException

from app.commerce import Checkout, Commerce, StressRequest
from app.sim.engine import SimEngine
from app.sim.navgrid import load_layout


@pytest.fixture
def commerce(tmp_path):
    engine = SimEngine(load_layout(), seed=42)
    engine.next_task_tick = 10**12  # Customer orders drive this test; no ambient demo work.
    service = Commerce(str(tmp_path / "commerce.db"), engine)
    yield service
    service.conn.close()


def checkout(**overrides):
    data = dict(customer_name="Test Müşteri", email="test@example.com", address="Kağıthane İstanbul",
                delivery_method="standard", items=[{"product_id": "WT-001", "quantity": 1}],
                idempotency_key=uuid.uuid4().hex)
    data.update(overrides)
    return Checkout(**data)


def advance(service, ticks=5):
    for _ in range(ticks):
        service.engine.step()
        service.advance()


def test_idempotent_checkout_and_atomic_stock(commerce):
    before = commerce.products()[0]["stock"]
    body = checkout(items=[{"product_id": "WT-001", "quantity": 2}, {"product_id": "WT-001", "quantity": 3}])
    first = commerce.checkout(body)
    assert commerce.checkout(body)["id"] == first["id"]
    assert commerce.products()[0]["stock"] == before - 5
    assert len(first["items"]) == 1
    assert first["total_cents"] == 5 * first["items"][0]["unit_price_cents"] + 4990
    with pytest.raises(HTTPException) as error:
        commerce.checkout(body.model_copy(update={"customer_name": "Farklı Müşteri"}))
    assert error.value.status_code == 409
    with commerce.conn:
        commerce.conn.execute("UPDATE commerce_products SET stock=0 WHERE id='WT-002'")
    with pytest.raises(HTTPException):
        commerce.checkout(checkout(items=[{"product_id": "WT-001", "quantity": 2}, {"product_id": "WT-002", "quantity": 1}]))
    assert commerce.products()[0]["stock"] == before - 5


def test_real_warehouse_lifecycle(commerce):
    order = commerce.checkout(checkout())
    code = order["tracking_code"]
    observed = {"received"}
    for _ in range(1400):
        advance(commerce)
        order = commerce.get_order(code)
        observed.add(order["status"])
        if order["status"] == "ready":
            break
    assert order["status"] == "ready", (order["status"], [(j, commerce.engine.state["tasks"].get(j["task_id"])) for j in order["jobs"]])
    assert observed == {"received", "picking", "packing", "loading", "ready"}
    assert len(order["task_ids"]) >= 2
    assert order["robot_ids"]
    assert all(j["done"] for j in order["jobs"])
    assert order["simulation_elapsed_seconds"] > 14
    assert commerce.admin()["metrics"]["ready_orders"] == 1


def test_recovery_requeues_without_double_reservation(commerce):
    order = commerce.checkout(checkout())
    advance(commerce)
    stock = commerce.products()[0]["stock"]
    engine = SimEngine(load_layout(), seed=43)
    commerce.recover(engine)
    recovered = commerce.get_order(order["tracking_code"])
    assert recovered["status"] == "received"
    assert recovered["task_ids"] == []
    assert "yeniden" in recovered["events"][-1]["message"]
    assert commerce.products()[0]["stock"] == stock
    advance(commerce)
    assert commerce.get_order(order["tracking_code"])["status"] == "picking"


def test_robot_failure_follows_reassignment(commerce):
    order = commerce.checkout(checkout(items=[{"product_id": "WT-001", "quantity": 4}]))
    advance(commerce, 10)
    current = commerce.get_order(order["tracking_code"])
    task = commerce.engine.state["tasks"][current["jobs"][0]["task_id"]]
    assert task["assigned_robot"]
    commerce.engine.inject({"kind": "ROBOT_FAILURE", "robot_id": task["assigned_robot"]})
    advance(commerce, 10)
    changed = commerce.get_order(order["tracking_code"])
    assert len(changed["task_ids"]) == 2
    assert changed["jobs"][0]["task_id"] != task["id"]
    assert commerce.engine.state["tasks"][changed["jobs"][0]["task_id"]]["load_units"] == 4
    assert changed["status"] != "ready"


def test_stress_uses_real_orders_without_depleting_customer_stock(commerce, monkeypatch):
    clock = [100.0]
    monkeypatch.setattr("app.commerce.time.monotonic", lambda: clock[0])
    stock = commerce.products()[0]["stock"]
    commerce.start_stress(StressRequest(rate_per_minute=100, duration_seconds=10))
    with pytest.raises(HTTPException):
        commerce.start_stress(StressRequest(rate_per_minute=5, duration_seconds=10))
    commerce.advance_stress()
    assert commerce.stress["created"] == 1
    clock[0] += 1.2
    commerce.advance_stress()
    assert commerce.stress["created"] == 3
    assert commerce.products()[0]["stock"] == stock
    assert all(o["source"] == "stress" for o in commerce.active())
    commerce.stop_stress()
    clock[0] += 20
    commerce.advance_stress()
    assert commerce.stress["created"] == 3


def test_active_queue_bound_does_not_reserve_stock(commerce):
    commerce.MAX_ACTIVE = 1
    commerce.checkout(checkout())
    stock = commerce.products()[0]["stock"]
    with pytest.raises(HTTPException) as error:
        commerce.checkout(checkout())
    assert error.value.status_code == 429
    assert commerce.products()[0]["stock"] == stock


def test_packing_station_capacity_is_enforced(commerce):
    commerce.stations = commerce.stations[:1]
    orders = [commerce.checkout(checkout()) for _ in range(3)]
    advance(commerce)
    # Isolate packing scheduling; physical path completion is covered separately.
    for task in commerce.engine.state["tasks"].values():
        task["status"] = "COMPLETED"
    commerce.engine.state["sim"]["tick"] += 5
    commerce.advance()
    commerce.engine.state["sim"]["tick"] += 5
    commerce.advance()
    active = [commerce.get_order(o["tracking_code"]) for o in orders]
    assert all(o["status"] == "packing" for o in active)
    assert sum(o["packing_until_tick"] is not None for o in active) == 1
    assert commerce.admin()["metrics"]["packing_queue"] == 2


def test_restart_preserves_orders_and_reservations(tmp_path):
    path = str(tmp_path / "restart.db")
    first = Commerce(path, SimEngine(load_layout()))
    order = first.checkout(checkout())
    first.conn.close()
    second = Commerce(path, SimEngine(load_layout()))
    try:
        restored = second.get_order(order["tracking_code"])
        assert restored["id"] == order["id"]
        assert second.products()[0]["stock"] == 249
        assert restored["status"] == "received"
    finally:
        second.conn.close()


def test_commerce_http_contract(commerce, monkeypatch):
    from fastapi.testclient import TestClient
    from app import main
    from app.main import TwinServer
    server = TwinServer(db_path=":memory:")
    server.commerce = commerce
    server.engine = commerce.engine
    server.paused = True
    monkeypatch.setattr(main, "server", server)
    with TestClient(main.app) as client:
        products = client.get("/api/commerce/products").json()["products"]
        assert len(products) == 8
        body = checkout().model_dump()
        response = client.post("/api/commerce/orders", json=body)
        assert response.status_code == 201
        order = response.json()
        tracked = client.get("/api/commerce/orders/" + order["tracking_code"]).json()
        assert tracked["status"] == "received"
        assert tracked["dispatch_plan"]["simulated_delivery"] is False
        assert client.post("/api/commerce/orders", json=body).json()["id"] == order["id"]
        body["items"][0]["quantity"] = -1
        assert client.post("/api/commerce/orders", json=body).status_code == 422
        assert client.get("/api/commerce/orders/WT-missing").status_code == 404
        admin = client.get("/api/commerce/admin").json()
        assert admin["metrics"]["active_orders"] == 1
        assert admin["performance"]["api_sample_count"] > 0
        assert client.post("/api/commerce/stress", json={"rate_per_minute": 17}).status_code == 422
        assert client.post("/api/commerce/stress", json={"rate_per_minute": 5, "duration_seconds": 10}).status_code == 200
        assert client.post("/api/commerce/stress/stop").json()["running"] is False
    server.db.close()


def test_stress_measures_actual_elapsed_and_freezes_after_stop(commerce, monkeypatch):
    clock = [200.0]
    monkeypatch.setattr('app.commerce.time.monotonic', lambda: clock[0])
    commerce.start_stress(StressRequest(rate_per_minute=100, duration_seconds=10))
    commerce.advance_stress()
    clock[0] += 1.2
    commerce.advance_stress()
    assert commerce.stress['created'] == 3
    assert commerce.stress['elapsed_seconds'] == 1.2
    assert commerce.stress['achieved_rate_per_minute'] == 150
    commerce.stop_stress()
    clock[0] += 20
    commerce.advance_stress()
    assert commerce.stress['elapsed_seconds'] == 1.2


def test_ready_order_never_tracks_a_reused_task_id(commerce):
    order = commerce.checkout(checkout())
    advance(commerce, 10)
    order = commerce.get_order(order['tracking_code'])
    assert order['robot_positions']
    with commerce.conn:
        commerce._event(order, 'ready', 'Test: outbound complete')
    # Completed history can retain IDs which a fresh engine later reuses.
    assert commerce.get_order(order['tracking_code'])['robot_positions'] == []
