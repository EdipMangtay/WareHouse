import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import fixture from '../../shared/navigation-fixture.json';
import { astar, canTraverse, cellCenter, edgeKey, toCell } from '../src/simulation/astar';
import { buildNavGrid } from '../src/layout/navgrid';
import type { WarehouseLayout, P2 } from '../src/layout/types';
import active from '../src/layout/active_layout.json';
import { SimEngine } from '../src/simulation/engine';
import small from '../../shared/layouts/small.json';

describe('shared spatial graph',()=>{
  it('matches Python on cells, directed adjacency and disrupted reachability',()=>{
    const grid=buildNavGrid(fixture.layout as unknown as WarehouseLayout);
    expect([...grid.cells]).toEqual(fixture.cells);expect([...grid.outgoing!]).toEqual(fixture.outgoing);
    grid.hardBlocked=new Set(fixture.blocked_cells.map(c=>c.join(',')));
    grid.blockedEdges=new Set(fixture.blocked_edges.map(([a,b])=>edgeKey(a as P2,b as P2)));
    for(const q of fixture.queries){const path=astar(grid,q.start as P2,q.goal as P2);expect(path!==null).toBe(q.reachable);if(path){let prev=q.start as P2;for(const next of path){expect(canTraverse(grid,prev,next)).toBe(true);prev=next;}}}
  });
  it('consumes the generated manifest without rasterizing a second interpretation',()=>{
    const layout=active as unknown as WarehouseLayout;
    expect(layout.navigation_graph).toBeDefined();
    for(const [floor,data] of Object.entries(layout.navigation_graph!.floors)){
      const grid=buildNavGrid(layout,Number(floor));
      expect(createHash('sha256').update(grid.cells).update(grid.outgoing!).digest('hex')).toBe(data.sha256);
    }
  });
  it('forbids reverse and diagonal bypass of one-way cells and blocked edges',()=>{
    const grid=buildNavGrid(fixture.layout as unknown as WarehouseLayout);
    expect(canTraverse(grid,[2,2],[3,2])).toBe(true);expect(canTraverse(grid,[3,2],[2,2])).toBe(false);expect(canTraverse(grid,[3,2],[2,3])).toBe(false);
    grid.blockedEdges=new Set([edgeKey([2,2],[3,2])]);expect(canTraverse(grid,[2,2],[3,3])).toBe(false);
    grid.hardBlocked=new Set(['3,2']);expect(astar(grid,[2,2],[3,2])).toBeNull();expect(astar(grid,[-1,0],[3,2])).toBeNull();
  });
  it('round-trips negative, boundary and fractional-resolution coordinates',()=>{
    expect(toCell(-.01,1)).toEqual([-1,1]);expect(toCell(1,2)).toEqual([1,2]);
    for(const cs of [.25,1,2.5])for(const c of [[0,0],[17,29],[-3,5]] as P2[])expect(toCell(...cellCenter(c,cs),cs)).toEqual(c);
  });
  it('preserves a blocked goal in the fallback movement engine then resumes',()=>{
    const layout=structuredClone(small) as unknown as WarehouseLayout;layout.spawn.robots=layout.spawn.robots.slice(0,1);
    const engine=new SimEngine(layout);
    // Exercise private motion entry points without invoking random task generation.
    const internal=engine as any,robot=internal.state.robots.R01,rt=internal.rt.R01;robot.position=[38.5,0,13.5];
    internal.rebuildOccupancy();internal.planTo(robot,rt,[41.5,13.5],'TO_SOURCE');expect(robot.path.length).toBeGreaterThan(0);
    internal.grids[1].hardBlocked=new Set(Array.from({length:60},(_,z)=>`40,${z}`));
    for(let i=0;i<80;i++){internal.rebuildOccupancy();internal.moveAlongPath(robot,rt);expect(toCell(robot.position[0],robot.position[2])[0]).toBeLessThan(40);}
    expect(rt.target).toEqual([41,13]);internal.grids[1].hardBlocked.clear();
    for(let i=0;i<400&&rt.target;i++){internal.rebuildOccupancy();internal.moveAlongPath(robot,rt);}
    expect(rt.target).toBeNull();expect(toCell(robot.position[0],robot.position[2])).toEqual([41,13]);
  });
});
