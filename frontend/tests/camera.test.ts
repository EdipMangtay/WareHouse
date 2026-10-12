import { describe, expect, it } from 'vitest';
import { clampCameraBoom } from '../src/components/scene/cameraCollision';

describe('warehouse follow camera', () => {
  const rack = { min: [2, 0, -2] as [number, number, number], max: [4, 6, 2] as [number, number, number] };
  it('shortens before entering a tall rack', () => {
    const position = clampCameraBoom([0, 1.5, 0], [6, 3, 0], [rack]);
    expect(position[0]).toBeGreaterThan(1);
    expect(position[0]).toBeLessThan(2);
    expect(position[1]).toBeGreaterThan(1.5);
  });
  it('keeps clear and elevated paths unchanged', () => {
    expect(clampCameraBoom([0, 1.5, 4], [6, 3, 4], [rack])).toEqual([6, 3, 4]);
    expect(clampCameraBoom([0, 8, 0], [6, 9, 0], [rack])).toEqual([6, 9, 0]);
  });
  it('uses the nearest obstacle regardless of order', () => {
    const farther = { min: [5, 0, -2] as [number, number, number], max: [7, 6, 2] as [number, number, number] };
    expect(clampCameraBoom([0, 1, 0], [8, 2, 0], [farther, rack])[0]).toBeLessThan(2);
  });
  it('allows a camera to exit a padded obstacle boundary', () => {
    expect(clampCameraBoom([2.05, 1, 0], [0, 2, 0], [rack])).toEqual([0, 2, 0]);
  });
});
