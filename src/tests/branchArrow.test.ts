import { describe, expect, it } from 'vitest';
import { branchArrow } from '../game/rooms/quizMaze';

describe('crossroads branch arrows', () => {
  it('reads corridors relative to a view facing north (yaw 0, forward −z)', () => {
    expect(branchArrow(0, -1, 0)).toBe('↑');
    expect(branchArrow(1, 0, 0)).toBe('→');
    expect(branchArrow(-1, 0, 0)).toBe('←');
    expect(branchArrow(0, 1, 0)).toBe('↓');
  });

  it('turns with the view', () => {
    // facing east (−x is behind): yaw −π/2 gives forward (1, 0)
    const east = -Math.PI / 2;
    expect(branchArrow(1, 0, east)).toBe('↑');
    expect(branchArrow(0, 1, east)).toBe('→');
    expect(branchArrow(0, -1, east)).toBe('←');
    // facing west
    expect(branchArrow(0, -1, Math.PI / 2)).toBe('→');
  });
});
