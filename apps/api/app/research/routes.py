import asyncio
from io import BytesIO
import json
from pathlib import Path
import tempfile
from zipfile import ZipFile, ZIP_DEFLATED

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import Response
from contracts.research import CreateSession, Command, SessionFrame
from warehouse_core.policies import POLICIES
from warehouse_core.telemetry.artifacts import save_run
from app.guard import origin_allowed
from .sessions import SessionRegistry, ROOT


def create_router(registry: SessionRegistry):
    router = APIRouter(prefix="/api/research", tags=["coordination experiments"])

    def get(sid):
        if sid not in registry.sessions:
            raise HTTPException(404, "unknown session")
        return registry.sessions[sid]

    @router.get("/catalog")
    async def catalog():
        return dict(schema_version="2.0", policies=POLICIES,
                    scenarios=[p.stem for p in sorted((ROOT/"experiments/scenarios").glob("*.json"))])

    @router.post("/sessions", response_model=SessionFrame, status_code=201)
    async def create(body: CreateSession):
        try:
            return (await registry.create(body)).frame()
        except (ValueError, TypeError) as error:
            raise HTTPException(400, str(error)) from error

    @router.get("/sessions/{sid}", response_model=SessionFrame)
    async def state(sid: str):
        session = get(sid)
        async with session.lock:
            return session.frame()

    @router.post("/sessions/{sid}/commands", response_model=SessionFrame)
    async def command(sid: str, body: Command):
        try:
            return await get(sid).command(body)
        except ValueError as error:
            raise HTTPException(409, str(error)) from error

    @router.delete("/sessions/{sid}", status_code=204)
    async def delete(sid: str):
        get(sid)
        await registry.delete(sid)

    @router.get("/sessions/{sid}/export")
    async def export(sid: str):
        session = get(sid)
        async with session.lock:
            with tempfile.TemporaryDirectory(prefix="waretwin-export-") as tmp:
                directory = Path(tmp)/"run"
                save_run(session.engine, directory, session.version)
                (directory/"commands.jsonl").write_text("".join(json.dumps(c)+"\n" for c in session.commands))
                output = BytesIO()
                with ZipFile(output, "w", ZIP_DEFLATED) as archive:
                    for path in sorted(directory.iterdir()):
                        archive.write(path, path.name)
                return Response(output.getvalue(), media_type="application/zip",
                    headers={"Content-Disposition": f'attachment; filename="waretwin-{sid}.zip"'})

    @router.websocket("/sessions/{sid}/stream")
    async def stream(ws: WebSocket, sid: str):
        if sid not in registry.sessions or not origin_allowed(ws.headers.get("origin")):
            await ws.close(code=1008); return
        await ws.accept()
        session = get(sid)
        previous = -1
        try:
            while sid in registry.sessions:
                async with session.lock:
                    frame = session.frame() if session.revision != previous else None
                if frame is not None:
                    previous = frame["revision"]
                    await ws.send_json(frame)
                # Receive with a timeout to detect disconnection even while the simulator is paused.
                try:
                    message = await asyncio.wait_for(ws.receive(), timeout=0.1)
                    if message["type"] == "websocket.disconnect":
                        break
                except asyncio.TimeoutError:
                    pass
        except (WebSocketDisconnect, RuntimeError):
            pass

    return router

