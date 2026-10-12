import type { WarehouseLayout } from '../../layout/types';

export type Point3 = [number, number, number];
export type CameraBox = { min: Point3; max: Point3 };

/** Visual follow-camera obstacles use the same physical layout as the warehouse. */
export function cameraObstacles(layout: WarehouseLayout, exploded: boolean): CameraBox[] {
  const boxes: CameraBox[] = [];
  const add = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => {
    boxes.push({ min: [x0 - .15, y0 - .1, z0 - .15], max: [x1 + .15, y1 + .1, z1 + .15] });
  };
  for (const rack of layout.racks) {
    const floor = rack.floor ?? 1;
    const y = (layout.floors.find(f => f.id === floor)?.elevation ?? 0) + (exploded && floor === 2 ? 5 : 0);
    add(rack.position[0], y, rack.position[2], rack.position[0] + rack.size[0], y + rack.size[1], rack.position[2] + rack.size[2]);
  }
  for (const obstacle of layout.obstacles ?? []) {
    add(obstacle.rect[0], 0, obstacle.rect[1], obstacle.rect[2], layout.size.height, obstacle.rect[3]);
  }
  for (const station of layout.stations) add(station.rect[0], 0, station.rect[1], station.rect[2], 2.5, station.rect[3]);
  for (const charger of layout.charging_stations) add(charger.position[0]-.45, 0, charger.position[2]-.4, charger.position[0]+.45, 1.4, charger.position[2]+.5);
  for (const conveyor of layout.conveyors) for (let i=1; i<conveyor.path.length; i++) {
    const a=conveyor.path[i-1], b=conveyor.path[i], half=conveyor.width/2;
    add(Math.min(a[0],b[0])-half,0,Math.min(a[1],b[1])-half,Math.max(a[0],b[0])+half,1.5,Math.max(a[1],b[1])+half);
  }
  for (const [x, z] of layout.columns ?? []) add(x - .45, 0, z - .45, x + .45, 8, z + .45);
  const { width: w, depth: d, height: h } = layout.size;
  add(-.4, 0, 0, 0, h, d); add(w, 0, 0, w + .4, h, d);
  add(0, 0, -.4, w, h, 0); add(0, 0, d, w, h, d + .4);
  return boxes;
}

/** Shorten the camera boom before it enters a rack, column or boundary wall. */
export function clampCameraBoom(anchor: Point3, desired: Point3, boxes: CameraBox[]): Point3 {
  let allowed = 1;
  for (const box of boxes) {
    let enter = 0, leave = 1;
    let intersects = true;
    let anchorInside = true;
    for (let axis = 0; axis < 3; axis++) {
      const delta = desired[axis] - anchor[axis];
      anchorInside &&= anchor[axis] >= box.min[axis] && anchor[axis] <= box.max[axis];
      if (Math.abs(delta) < 1e-8) {
        if (anchor[axis] < box.min[axis] || anchor[axis] > box.max[axis]) { intersects = false; break; }
      } else {
        const first = (box.min[axis] - anchor[axis]) / delta;
        const second = (box.max[axis] - anchor[axis]) / delta;
        enter = Math.max(enter, Math.min(first, second));
        leave = Math.min(leave, Math.max(first, second));
        if (enter > leave) { intersects = false; break; }
      }
    }
    // Allow a valid robot standing at a padded boundary to move its camera out.
    if (intersects && !anchorInside && enter >= 0) allowed = Math.min(allowed, Math.max(0, enter - .04));
  }
  return anchor.map((value, axis) => value + (desired[axis] - value) * allowed) as Point3;
}
