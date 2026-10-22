from typing import Annotated, Literal, Union, Any
from pydantic import BaseModel, ConfigDict, Field

Policy = Literal["fifo", "order_aware", "gwo_conveyor", "local_search", "gwo_integrated"]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class CreateSession(StrictModel):
    scenario: str = Field(default="balanced", pattern=r"^[a-z_]+$")
    scenario_seed: int = 42
    algorithm_seed: int = 7
    policy: Policy = "fifo"
    search_budget: int = Field(default=12, ge=1, le=128)
    time_limit_ms: float | None = Field(default=None, gt=0, le=2000)


class CommandBase(StrictModel):
    command_id: str = Field(min_length=1, max_length=80)


class Play(CommandBase):
    action: Literal["PLAY"]
    speed: float = Field(default=1, ge=0.25, le=20)


class Pause(CommandBase):
    action: Literal["PAUSE"]


class Step(CommandBase):
    action: Literal["STEP"]
    ticks: int = Field(default=1, ge=1, le=200)


class Reset(CommandBase):
    action: Literal["RESET"]


class SetPolicy(CommandBase):
    action: Literal["SET_POLICY"]
    policy: Policy


class Inject(CommandBase):
    action: Literal["INJECT"]
    kind: Literal["ROBOT_FAILURE", "BELT_STOP", "PACKING_FAILURE"]
    target: str | None = Field(default=None, max_length=80)
    duration_s: float = Field(default=20, gt=0, le=3600)


class AddOrder(CommandBase):
    action: Literal["ADD_ORDER"]
    order_id: str = Field(min_length=1, max_length=80, pattern=r"^[A-Za-z0-9_-]+$")
    zones: list[str] = Field(min_length=1, max_length=100)
    due_after_s: float = Field(default=120, gt=0, le=86400)


Command = Annotated[Union[Play, Pause, Step, Reset, SetPolicy, Inject, AddOrder], Field(discriminator="action")]


class Snapshot(StrictModel):
    schema_version: Literal["2.0"]
    tick: int
    time_s: float
    tick_s: float
    policy: Policy
    scenario: str
    scenario_seed: int
    algorithm_seed: int
    config: dict[str, Any]
    orders: list[dict[str, Any]]
    items: list[dict[str, Any]]
    tasks: list[dict[str, Any]]
    robots: list[dict[str, Any]]
    carriers: list[dict[str, Any]]
    packages: list[dict[str, Any]]
    packing: list[dict[str, Any]]
    zones: list[dict[str, Any]]
    belt: dict[str, Any]
    consolidation: dict[str, Any]
    reservations: list[dict[str, Any]]
    events: list[dict[str, Any]]
    decisions: list[dict[str, Any]]
    metrics: dict[str, Any]
    finished: bool


class SessionFrame(StrictModel):
    type: Literal["SNAPSHOT"] = "SNAPSHOT"
    session_id: str
    revision: int
    generation: int
    paused: bool
    speed: float
    error: str | None
    state: Snapshot

