"""Standalone experiment service: uvicorn apps.api.research:app from the root."""
import sys
from pathlib import Path
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

sys.path.insert(0, str(Path(__file__).resolve().parent))
import app  # initializes source-checkout package path
from app.research.routes import create_router
from app.research.sessions import SessionRegistry

registry = SessionRegistry()


@asynccontextmanager
async def lifespan(_app):
    yield
    await registry.close()


app = FastAPI(title="WareTwin coordination experiments", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
                   allow_methods=["*"], allow_headers=["*"])
app.include_router(create_router(registry))

