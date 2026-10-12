import type { WarehouseLayout } from './types';

/** Include outdoor equipment without changing the robots' indoor navigation grid. */
export function sceneBounds(layout: WarehouseLayout) {
  const bounds = layout.conveyor_network?.apron_bounds ?? [0, 0, layout.size.width, layout.size.depth];
  const [x0, z0, x1, z1] = bounds;
  return {
    x0, z0, x1, z1, width: x1 - x0, depth: z1 - z0,
    center: [(x0 + x1) / 2, 0, (z0 + z1) / 2] as [number, number, number],
    size: [x1 - x0, layout.size.height, z1 - z0] as [number, number, number],
  };
}
