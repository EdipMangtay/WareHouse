import type { NavGrid } from '../../simulation/astar';

export type WalkPoint = [number, number];
export type WalkAction = 'forward' | 'back' | 'left' | 'right' | 'turnLeft' | 'turnRight';
export const EYE_HEIGHT = 1.72;
export const WALK_RADIUS = .22;

/** Shared only by the main camera and its on-screen controls, never the simulation. */
export const walkInput = { held: new Set<WalkAction>() };
export function clearWalkInput() { walkInput.held.clear(); }

export function canStand(grid: NavGrid, x: number, z: number): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
  const cs = grid.cellSize ?? 1;
  for (const dx of [-WALK_RADIUS, WALK_RADIUS]) for (const dz of [-WALK_RADIUS, WALK_RADIUS]) {
    const c = Math.floor((x + dx) / cs), r = Math.floor((z + dz) / cs);
    if (c < 0 || r < 0 || c >= grid.cols || r >= grid.rows || grid.cells[r * grid.cols + c] === 1) return false;
  }
  return true;
}

/** A map click on a rack resolves to the nearest clear aisle, never inside a solid. */
export function nearestWalkPoint(grid: NavGrid, point: WalkPoint): WalkPoint | null {
  if (!point.every(Number.isFinite)) return null;
  if (canStand(grid, ...point)) return [...point];
  const cs = grid.cellSize ?? 1;
  let best: WalkPoint | null = null, distance = Infinity;
  for (let r = 0; r < grid.rows; r++) for (let c = 0; c < grid.cols; c++) {
    const x = (c + .5) * cs, z = (r + .5) * cs;
    const d = (x - point[0]) ** 2 + (z - point[1]) ** 2;
    if (d < distance && grid.cells[r * grid.cols + c] !== 1 && canStand(grid, x, z)) { best = [x, z]; distance = d; }
  }
  return best;
}

/** Substeps prevent tunnelling; axis sliding makes narrow aisles easy to navigate. */
export function moveWalkPoint(grid: NavGrid, from: WalkPoint, delta: WalkPoint): WalkPoint {
  if (!canStand(grid, ...from) || !delta.every(Number.isFinite)) return [...from];
  const steps = Math.max(1, Math.ceil(Math.hypot(...delta) / .15));
  const dx = delta[0] / steps, dz = delta[1] / steps;
  let [x, z] = from;
  for (let i = 0; i < steps; i++) {
    if (canStand(grid, x + dx, z)) x += dx;
    if (canStand(grid, x, z + dz)) z += dz;
  }
  return [x, z];
}

export function walkDisplacement(forward: number, right: number, yaw: number, distance: number): WalkPoint {
  const scale = distance / Math.max(1, Math.hypot(forward, right));
  return [(Math.sin(yaw) * forward + Math.cos(yaw) * right) * scale,
    (-Math.cos(yaw) * forward + Math.sin(yaw) * right) * scale];
}
