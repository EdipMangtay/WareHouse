"""Developer navigation snapshot and bounded, atomic temporary disruptions."""
from __future__ import annotations
from typing import Literal
from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field, StrictInt
from .sim.spatial import validate_navigation

class NavigationChange(BaseModel):
    model_config=ConfigDict(extra='forbid')
    floor: StrictInt = 1
    action: Literal['block','unblock']
    cells: list[tuple[StrictInt,StrictInt]] = Field(default_factory=list,max_length=256)
    edges: list[tuple[tuple[StrictInt,StrictInt],tuple[StrictInt,StrictInt]]] = Field(default_factory=list,max_length=256)
    bidirectional: bool = True


def create_navigation_router(get_server, throttle):
    router=APIRouter(prefix='/api/navigation',tags=['warehouse-navigation'])
    @router.get('')
    async def snapshot(floor:int=Query(1)):
        server=get_server();engine=server.engine
        if floor not in engine.grids: raise HTTPException(404,'Unknown navigation floor')
        engine._sync_navigation()
        grid=engine.grids[floor]
        return dict(layout_revision=server.layout['revision'],revision=engine.navigation_revision,tick=engine.state['sim']['tick'],floor=floor,
                    blocked_cells=[list(c) for c in sorted(grid.hard_blocked)],manual_cells=[list(c) for c in sorted(engine.navigation_blocks[floor])],
                    blocked_edges=[[list(a),list(b)] for a,b in sorted(grid.blocked_edges)],
                    validation=server.layout['navigation_graph']['validation'])
    @router.get('/validate')
    async def validate():
        engine=get_server().engine;engine._sync_navigation()
        return dict(tick=engine.state['sim']['tick'],**validate_navigation(engine.layout,engine.grids))
    @router.post('/disruptions')
    async def change(body:NavigationChange, request:Request):
        throttle(request,"mutate")
        if not body.cells and not body.edges: raise HTTPException(422,'Specify cells or edges')
        server=get_server()
        try: server.engine.change_navigation(body.floor,body.cells,body.edges,body.action=='block',body.bidirectional)
        except ValueError as error: raise HTTPException(422,str(error)) from error
        return dict(ok=True,revision=server.engine.navigation_revision)
    return router
