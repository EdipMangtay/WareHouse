import { describe, expect, it } from 'vitest';
import type { NavGrid } from '../src/simulation/astar';
import { canStand, moveWalkPoint, nearestWalkPoint, walkDisplacement } from '../src/components/scene/walking';
import { buildNavGrid } from '../src/layout/navgrid';
import { layout, useStore } from '../src/state/store';

function corridor(): NavGrid {
  const grid={cols:10,rows:10,cells:new Uint8Array(100),cellSize:1};
  for(let row=0;row<10;row++)grid.cells[row*10+5]=1;
  return grid;
}

describe('independent walking camera',()=>{
  it('cannot tunnel through a one-cell wall during a large movement',()=>{
    const grid=corridor(),p=moveWalkPoint(grid,[2.5,4.5],[20,0]);
    expect(p[0]).toBeGreaterThan(4.5);expect(p[0]).toBeLessThan(4.8);expect(canStand(grid,...p)).toBe(true);
  });
  it('slides along obstacles while retaining body clearance',()=>{
    const grid=corridor(),p=moveWalkPoint(grid,[4.5,2.5],[3,4]);
    expect(p[0]).toBeLessThan(4.8);expect(p[1]).toBeCloseTo(6.5);expect(canStand(grid,...p)).toBe(true);
  });
  it('never exits the navigation footprint',()=>{
    const grid=corridor();
    for(const d of [[-30,0],[0,-30],[0,30]] as [number,number][]){const p=moveWalkPoint(grid,[2.5,4.5],d);expect(canStand(grid,...p)).toBe(true);}
  });
  it('normalizes diagonal speed and follows the camera heading',()=>{
    expect(Math.hypot(...walkDisplacement(1,1,0,3))).toBeCloseTo(3);
    expect(walkDisplacement(1,0,0,3)).toEqual([0,-3]);
    expect(walkDisplacement(1,0,Math.PI/2,3)[0]).toBeCloseTo(3);
    expect(walkDisplacement(0,0,0,3)).toEqual([0,0]);
  });
  it('relocates map clicks inside obstacles to a safe aisle',()=>{
    const grid=corridor(),p=nearestWalkPoint(grid,[5.5,4.5]);
    expect(p).not.toBeNull();expect(canStand(grid,...p!)).toBe(true);
    expect(Math.hypot(p![0]-5.5,p![1]-4.5)).toBe(1);
  });
  it('rejects invalid targets and fully blocked floors',()=>{
    const grid=corridor();expect(nearestWalkPoint(grid,[NaN,1])).toBeNull();
    grid.cells.fill(1);expect(nearestWalkPoint(grid,[5,5])).toBeNull();
  });
  it('has safe entry points at every storage sector and the main aisle',()=>{
    const grid=buildNavGrid(layout);
    const points=layout.zones.filter(z=>z.id.startsWith('ZONE_')).map(z=>[z.polygon.reduce((sum,p)=>sum+p[0],0)/z.polygon.length,z.polygon.reduce((sum,p)=>sum+p[1],0)/z.polygon.length] as [number,number]);
    points.push([layout.size.width/2,14.5]);
    for(const point of points){const safe=nearestWalkPoint(grid,point);expect(safe).not.toBeNull();expect(canStand(grid,...safe!)).toBe(true);}
  });
  it('does not modify simulation state when entering, relocating or adjusting the camera',()=>{
    const s=useStore.getState(),twin=s.twin;
    s.enterWalk([90,14.5]);s.setWalkPose({x:90,z:18,yaw:Math.PI});s.setCameraSettings({fov:75});
    const next=useStore.getState();expect(next.twin).toBe(twin);expect(next.cameraMode).toBe('walk');expect(next.activeFloor).toBe(1);
    expect(next.walkTarget).toEqual([90,14.5]);expect(next.viewTab).toBe('3D');s.setCameraMode('orbit');
  });
  it('bounds camera settings and rejects non-finite slider values',()=>{
    const s=useStore.getState();s.setCameraSettings({walkSpeed:100,fov:2,exposure:NaN,sensitivity:-4});
    const next=useStore.getState().cameraSettings;
    expect(next.walkSpeed).toBe(8);expect(next.fov).toBe(45);expect(next.sensitivity).toBe(.3);expect(Number.isFinite(next.exposure)).toBe(true);
  });
});
