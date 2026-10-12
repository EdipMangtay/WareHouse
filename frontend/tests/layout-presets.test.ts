import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import small from '../../shared/layouts/small.json';
import medium from '../../shared/layouts/medium.json';
import large from '../../shared/layouts/large.json';
import mega from '../../shared/layouts/mega.json';
import { buildNavGrid } from '../src/layout/navgrid';
import { astar, toCell } from '../src/simulation/astar';
import type { WarehouseLayout } from '../src/layout/types';
import { sceneBounds } from '../src/layout/sceneBounds';

describe('canonical warehouse presets', () => {
  for (const fixture of [small, medium, large, mega]) {
    it(`${fixture.metadata.preset}: camera and map include every exterior belt`, () => {
      const layout = fixture as unknown as WarehouseLayout;
      const bounds = sceneBounds(layout);
      for (const c of layout.conveyors) for (const [x,z] of c.path) {
        expect(x-c.width/2).toBeGreaterThan(bounds.x0);
        expect(x+c.width/2).toBeLessThan(bounds.x1);
        expect(z-c.width/2).toBeGreaterThan(bounds.z0);
        expect(z+c.width/2).toBeLessThan(bounds.z1);
      }
      expect(bounds.center).toEqual([layout.size.width/2,0,layout.size.depth/2]);
    });
    it(`${fixture.metadata.preset}: Python and browser grids agree and distant access points connect`, () => {
      const layout = fixture as unknown as WarehouseLayout;
      const grid = buildNavGrid(layout);
      expect(createHash('sha256').update(grid.cells).digest('hex')).toBe(fixture.metadata.validation.navigation_sha256);
      const start = layout.spawn.robots[0].position;
      for (const location of layout.locations.filter((_, i) => i % 17 === 0 || !layout.locations[i].rack_id)) {
        const path = astar(grid, toCell(start[0], start[2]), toCell(...location.access_point));
        expect(path, location.id).not.toBeNull();
        for (const [x,z] of path!) expect(grid.cells[z * grid.cols + x]).not.toBe(1);
      }
    });
  }
});
