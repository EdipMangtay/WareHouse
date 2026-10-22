import type { RobotState, TwinState } from '../schema/twin_state';
import type { Parcel } from '../schema/conveyor';
import type { LayoutConveyor } from '../layout/types';

type Point = [number, number, number];
export type MotionFrame = { a: TwinState; b: TwinState; u: number; tick: number };
const mix = (a: number, b: number, u: number) => a + (b-a)*u;
export const mixAngle = (a: number, b: number, u: number) => a + Math.atan2(Math.sin(b-a), Math.cos(b-a))*u;

/** One bounded presentation timeline for the whole warehouse, independent of FPS.
 * No velocities are integrated here. The cursor can never pass the newest data.
 * Keeping every received tick (before React coalescing) preserves corner geometry.
 */
export class SnapshotMotion {
  private frames: { twin: TwinState; received: number }[] = [];
  private cursor = 0;
  reset(twin?: TwinState, now = performance.now()) {
    this.frames = twin ? [{ twin, received: now }] : [];
    this.cursor = twin?.sim.tick ?? 0;
  }
  push(twin: TwinState, now = performance.now()) {
    const last = this.frames[this.frames.length-1]?.twin;
    if (!last || twin.sim.tick < last.sim.tick || twin.sim.speed !== last.sim.speed || twin.sim.mode !== last.sim.mode) {
      this.reset(twin, now); return;
    }
    if (twin.sim.tick === last.sim.tick) this.frames[this.frames.length-1] = { twin, received: now };
    else this.frames.push({ twin, received: now });
    if (this.frames.length > 64) this.frames.shift();
  }
  sample(now = performance.now()): MotionFrame | null {
    const last = this.frames[this.frames.length-1];
    if (!last) return null;
    const { sim } = last.twin;
    // One authoritative step + transport coalescing margin; 125 ms at 1×.
    const delayMs = sim.tick_ms / Math.max(.25, sim.speed) + 25;
    const target = sim.mode === 'PAUSED' || !sim.speed ? sim.tick : sim.tick + (now-last.received-delayMs)*sim.speed/sim.tick_ms;
    this.cursor = Math.min(sim.tick, Math.max(this.cursor, target, this.frames[0].twin.sim.tick));
    for (let i=1; i<this.frames.length; i++) {
      const a = this.frames[i-1].twin, b = this.frames[i].twin;
      if (b.sim.tick >= this.cursor) return { a, b, u: (this.cursor-a.sim.tick)/(b.sim.tick-a.sim.tick), tick: this.cursor };
    }
    return { a: last.twin, b: last.twin, u: 1, tick: sim.tick };
  }
}
export const presentation = new SnapshotMotion();

function along(points: Point[], u: number): Point {
  const lengths = points.slice(1).map((p,i)=>Math.hypot(...p.map((v,k)=>v-points[i][k])));
  let left = lengths.reduce((a,b)=>a+b,0)*u;
  for (let i=0; i<lengths.length; i++) {
    if (left <= lengths[i] && lengths[i] > 1e-9) return points[i].map((v,k)=>mix(v,points[i+1][k],left/lengths[i])) as Point;
    left -= lengths[i];
  }
  return points[points.length-1];
}

export function robotPose(frame: MotionFrame | null, fallback: RobotState) {
  const a = frame?.a.robots[fallback.id] ?? fallback, b = frame?.b.robots[fallback.id] ?? fallback, u = frame?.u ?? 1;
  const state = u < 1 ? a : b;
  const points: Point[] = [a.position];
  if (a.path === b.path && b.path_index >= a.path_index) {
    for (let i=a.path_index; i<b.path_index; i++) points.push([a.path[i][0]+.5, 0, a.path[i][1]+.5]);
  } else if (Math.hypot(a.position[0]-b.position[0],a.position[2]-b.position[2]) > .3) {
    // A reroute/resync is not permission to draw a chord through a rack.
    return { position: state.position, heading: state.heading, robot: state, progress: operationProgress(state) };
  }
  points.push(b.position);
  return { position: along(points,u), heading: mixAngle(a.heading,b.heading,u), robot: state,
    progress: a.fsm === b.fsm && a.current_task_id === b.current_task_id ? mix(operationProgress(a),operationProgress(b),u) : operationProgress(state) };
}
export function operationProgress(robot: RobotState) {
  return Math.max(0,Math.min(1,(robot.operation_elapsed_ticks ?? 0)/Math.max(1,robot.operation_duration_ticks ?? 1)));
}
export function liftHeight(frame: MotionFrame | null, id: string, fallback = 0) {
  if (!frame) return fallback;
  return mix(frame.a.lifts[id]?.y ?? fallback, frame.b.lifts[id]?.y ?? fallback, frame.u);
}
export function robotElevation(frame: MotionFrame | null, robot: RobotState, floors: Record<number, number>, exploded = false) {
  return robot.lift_id
    ? liftHeight(frame, robot.lift_id, floors[robot.floor] ?? 0)
    : (floors[robot.floor] ?? 0) + (exploded && robot.floor === 2 ? 5 : 0);
}
export function beltDistance(frame: MotionFrame | null, id: string, fallback = 0) {
  if (!frame) return fallback;
  return mix(frame.a.conveyors[id]?.travelled_m ?? fallback, frame.b.conveyors[id]?.travelled_m ?? fallback, frame.u);
}

export function parcelAt(p: Parcel, segments: Record<string, LayoutConveyor>): Point {
  const c = segments[p.current_conveyor_segment ?? p.route[0]];
  if (!c) return [0,0,0];
  const points = c.path.map(([x,z])=>[x,.875+p.package_dimensions[1]/2,z] as Point);
  const length = c.length_m ?? c.path.slice(1).reduce((sum,b,i)=>sum+Math.hypot(b[0]-c.path[i][0],b[1]-c.path[i][1]),0);
  return along(points,Math.min(1,p.conveyor_position/length));
}
export function parcelPose(frame: MotionFrame | null, fallback: Parcel, segments: Record<string,LayoutConveyor>) {
  const a = frame?.a.packages?.[fallback.package_id] ?? fallback, b = frame?.b.packages?.[fallback.package_id] ?? fallback, u = frame?.u ?? 1;
  const p = u < 1 ? a : b;
  if (a.status === 'ON_CONVEYOR' && b.status === 'ON_CONVEYOR' && b.route_index >= a.route_index) {
    // Interpolate arc distance along the connected route, never diagonally
    // across a conveyor corner or across a junction into another lane.
    let distance = b.conveyor_position-a.conveyor_position;
    for (let i=a.route_index; i<b.route_index; i++) distance += segments[a.route[i]].length_m!;
    let at = a.conveyor_position + Math.max(0,distance)*u, index = a.route_index;
    while (index<b.route_index && at>segments[a.route[index]].length_m!) { at-=segments[a.route[index]].length_m!; index++; }
    const sampled = { ...p, current_conveyor_segment: a.route[index], conveyor_position: at };
    return { parcel: sampled, position: parcelAt(sampled,segments) };
  }
  return { parcel: p, position: parcelAt(p,segments) };
}

/** The same carton remains visible through the core's pick/carry/drop phases.
 * Pickup is a schematic reach within the service cell, timed by PICK_TICKS.
 * Ownership is still changed only by the core at the end of the dwell.
 */
export function robotParcelPose(frame: MotionFrame | null, parcel: Parcel, robot: RobotState, segments: Record<string,LayoutConveyor>, elevation = 0) {
  const pose = robotPose(frame, robot), phase = pose.robot.fsm;
  const smooth = (u: number) => u*u*(3-2*u);
  const pickup = phase === 'PICKING' ? smooth(pose.progress) : 1;
  const reach = mix(.8, .47, pickup);
  const carried: Point = [pose.position[0]+Math.cos(pose.heading)*reach, elevation+mix(.8,1.36,pickup), pose.position[2]+Math.sin(pose.heading)*reach];
  if (phase !== 'DELIVERING') return { position: carried, heading: pose.heading };
  const target = parcelAt(parcel, segments), u = smooth(pose.progress);
  const segment = segments[parcel.route[0]], first = segment.path[0], next = segment.path[1];
  return { position: carried.map((v,i)=>mix(v,target[i],u)) as Point,
    heading: mixAngle(pose.heading,Math.atan2(next[1]-first[1],next[0]-first[0]),u) };
}
