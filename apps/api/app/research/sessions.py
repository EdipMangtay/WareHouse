from __future__ import annotations
import asyncio
from collections import OrderedDict
import json
from pathlib import Path
from time import monotonic
import uuid

from contracts.research import CreateSession, SessionFrame
from warehouse_core.simulation.engine import Simulation
from warehouse_core.simulation.scenario import load_scenario
from warehouse_core.telemetry.artifacts import save_run, version_info

ROOT = Path(__file__).resolve().parents[4]


class Session:
    def __init__(self, request: CreateSession, output: Path, version: dict):
        path = ROOT/"experiments/scenarios"/f"{request.scenario}.json"
        if not path.is_file():
            raise ValueError("unknown scenario")
        self.id = uuid.uuid4().hex
        self.request, self.scenario = request, load_scenario(path, request.scenario_seed)
        self.engine = self._new_engine()
        self.paused, self.speed, self.accumulator = True, 1.0, 0.0
        self.revision, self.generation = 0, 0
        self.lock = asyncio.Lock()
        self.worker: asyncio.Task | None = None
        self.error: str | None = None
        self.commands: list[dict] = []
        self.seen: OrderedDict[str, dict] = OrderedDict()
        self.last_access = monotonic()
        self.output, self.version, self.archived_revision = output, version, -1

    def _new_engine(self):
        r = self.request
        return Simulation(self.scenario, r.policy, r.algorithm_seed, r.search_budget, r.time_limit_ms)

    def frame(self):
        self.last_access = monotonic()
        return SessionFrame(session_id=self.id, revision=self.revision, generation=self.generation,
                            paused=self.paused, speed=self.speed, error=self.error, state=self.engine.snapshot()).model_dump()

    def archive(self):
        if self.archived_revision == self.revision:
            return
        path = self.output/f"{self.id}-g{self.generation}-r{self.revision}"
        save_run(self.engine, path, self.version)
        (path/"commands.jsonl").write_text("".join(json.dumps(c)+"\n" for c in self.commands))
        self.archived_revision = self.revision

    async def command(self, command):
        async with self.lock:
            body = command.model_dump()
            if command.command_id in self.seen:
                if self.seen[command.command_id] != body:
                    raise ValueError("command_id already used with different content")
                return self.frame()
            action = command.action
            at = self.engine.now
            if action == "STEP":
                if not self.paused:
                    raise ValueError("pause before stepping")
                await asyncio.to_thread(self.engine.step, command.ticks)
            elif action == "PLAY":
                if self.error:
                    raise ValueError("reset session after a simulation error")
                self.paused, self.speed = False, command.speed
                self.accumulator = 0
            elif action == "PAUSE":
                self.paused, self.accumulator = True, 0
            elif action == "RESET":
                await asyncio.to_thread(self.archive)
                self.engine = self._new_engine()
                self.paused, self.accumulator, self.error = True, 0, None
                self.generation += 1
                self.commands = []
                if self.worker is None or self.worker.done():
                    self.worker = asyncio.create_task(self.run())
            elif action == "INJECT":
                self.engine.inject(command.kind, command.target, command.duration_s)
            elif action == "SET_POLICY":
                self.engine.policy = command.policy
                self.engine.replan_reason = "policy_changed"
            elif action == "ADD_ORDER":
                if command.order_id in {o["id"] for o in self.scenario.orders}:
                    raise ValueError("order ID is reserved by the scenario")
                self.engine.add_order(dict(id=command.order_id, zones=command.zones,
                    arrival_s=self.engine.now, due_s=self.engine.now+command.due_after_s))
            self.commands.append(dict(at_s=at, generation=self.generation, **body))
            self.seen[command.command_id] = body
            if len(self.seen) > 4096:
                self.seen.popitem(last=False)
            self.revision += 1
            return self.frame()

    async def run(self):
        last = monotonic()
        try:
            while True:
                await asyncio.sleep(0.05)
                current = monotonic()
                dt, last = min(0.25, current-last), current
                async with self.lock:
                    if self.paused:
                        continue
                    self.accumulator += dt*self.speed
                    count = min(4, int(self.accumulator/self.engine.config.tick_s))
                    if count:
                        await asyncio.to_thread(self.engine.step, count)
                        self.accumulator -= count*self.engine.config.tick_s
                        self.revision += 1
                        if self.engine.finished or self.engine.now >= self.scenario.horizon_s:
                            self.paused = True
                            await asyncio.to_thread(self.archive)
        except asyncio.CancelledError:
            raise
        except Exception as error:
            self.error, self.paused = f"{type(error).__name__}: {error}", True
            self.revision += 1


class SessionRegistry:
    def __init__(self, output: Path | None = None):
        self.sessions: dict[str, Session] = {}
        self.output = output or ROOT/"experiments/results/live"
        self.version = None

    async def create(self, request):
        for sid, session in list(self.sessions.items()):
            if monotonic()-session.last_access > 3600:
                await self.delete(sid)
        if len(self.sessions) >= 8:
            raise ValueError("8 active sessions; close an existing session first")
        if self.version is None:
            self.version = version_info(ROOT)
        session = Session(request, self.output, self.version)
        self.sessions[session.id] = session
        session.worker = asyncio.create_task(session.run())
        return session

    async def delete(self, sid):
        session = self.sessions.pop(sid)
        # Acquire the lock first, so cancellation never leaves a worker thread mutating an archived engine.
        async with session.lock:
            session.paused = True
            if session.worker:
                session.worker.cancel()
            await asyncio.to_thread(session.archive)
        if session.worker:
            try:
                await session.worker
            except asyncio.CancelledError:
                pass

    async def close(self):
        for sid in list(self.sessions):
            await self.delete(sid)

