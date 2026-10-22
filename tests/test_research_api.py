from contextlib import asynccontextmanager
from io import BytesIO
import json
from zipfile import ZipFile
from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

from app.research.routes import create_router
from app.research.sessions import SessionRegistry, ROOT
from warehouse_core.simulation.engine import Simulation
from warehouse_core.simulation.scenario import load_scenario


@pytest.fixture
def client(tmp_path):
    registry = SessionRegistry(tmp_path)
    @asynccontextmanager
    async def lifespan(app):
        yield
        await registry.close()
    app = FastAPI(lifespan=lifespan)
    app.include_router(create_router(registry))
    with TestClient(app) as client:
        yield client


def test_api_and_headless_share_identical_events_and_commands(client):
    body = dict(scenario="balanced", scenario_seed=23, policy="fifo", algorithm_seed=17)
    created = client.post("/api/research/sessions", json=body)
    assert created.status_code == 201, created.text
    frame = created.json(); sid = frame["session_id"]
    base = f"/api/research/sessions/{sid}"
    assert frame["paused"] and frame["state"]["tick"] == 0
    engine = Simulation(load_scenario(ROOT/"experiments/scenarios/balanced.json", 23), "fifo", 17)
    with client.websocket_connect(base+"/stream") as ws:
        streamed = ws.receive_json()
        assert streamed == frame
        cmd = dict(command_id="step-1", action="STEP", ticks=100)
        response = client.post(base+"/commands", json=cmd)
        assert response.status_code == 200, response.text
        engine.step(100)
        state = response.json()["state"]
        assert state["orders"] == engine.snapshot()["orders"]
        assert state["carriers"] == engine.snapshot()["carriers"]
        assert state["events"] == engine.snapshot()["events"]
        # Network retry is idempotent. Reusing identity with different content is rejected.
        assert client.post(base+"/commands", json=cmd).json()["state"]["tick"] == 100
        assert client.post(base+"/commands", json=cmd | {"ticks":1}).status_code == 409
        assert ws.receive_json()["state"]["tick"] == 100
    assert client.post(base+"/commands", json=dict(command_id="bad",action="STEP",ticks=0)).status_code == 422
    assert client.post(base+"/commands", json=dict(command_id="x",action="INJECT",kind="ROBOT_FAILURE",target="unknown")).status_code == 409
    result = client.post(base+"/commands", json=dict(command_id="order",action="ADD_ORDER",order_id="LIVE1",zones=["Z1","Z4"]))
    assert result.status_code == 200 and any(o["id"] == "LIVE1" for o in result.json()["state"]["orders"])
    exported = client.get(base+"/export")
    assert exported.status_code == 200
    with ZipFile(BytesIO(exported.content)) as archive:
        assert {"events.jsonl","decisions.jsonl","orders.json","metrics.json","run.json","commands.jsonl"} <= set(archive.namelist())
        assert json.loads(archive.read("run.json"))["scenario_seed"] == 23
    reset = client.post(base+"/commands", json=dict(command_id="reset",action="RESET")).json()
    assert reset["paused"] and reset["state"]["tick"] == 0 and reset["generation"] == 1
    assert reset["revision"] > frame["revision"]
    assert client.delete(base).status_code == 204
    assert client.get(base).status_code == 404


def test_sessions_isolate_state_and_validate_scenarios(client):
    a,b = [client.post("/api/research/sessions",json={}).json() for _ in range(2)]
    client.post(f"/api/research/sessions/{a['session_id']}/commands",
                json=dict(command_id="step",action="STEP",ticks=10))
    assert client.get(f"/api/research/sessions/{b['session_id']}").json()["state"]["tick"] == 0
    assert client.post("/api/research/sessions",json={"scenario":"../../secret"}).status_code == 422
    assert client.post("/api/research/sessions",json={"scenario":"missing"}).status_code == 400
    assert client.post("/api/research/sessions",json={"policy":"magic"}).status_code == 422


def test_play_pause_does_not_change_operational_units(client):
    from time import sleep
    frame = client.post("/api/research/sessions",json={}).json()
    base = f"/api/research/sessions/{frame['session_id']}"
    response = client.post(base+"/commands",json=dict(command_id="play",action="PLAY",speed=20)).json()
    assert response["speed"] == 20 and not response["paused"]
    assert client.post(base+"/commands",json=dict(command_id="invalid",action="STEP")).status_code == 409
    sleep(0.2)
    paused = client.post(base+"/commands",json=dict(command_id="pause",action="PAUSE")).json()
    assert paused["state"]["time_s"] == paused["state"]["tick"] * paused["state"]["tick_s"]
    sleep(0.1)
    assert client.get(base).json()["state"]["tick"] == paused["state"]["tick"]
