import { describe, expect, it } from 'vitest';
import { generateMaze, generateQuizMaze, mazeRects, openSides, reachableCells, solutionPath, MAZE_COLS } from '../game/loop/maze';
import { mulberry32 } from '../game/rng';

describe('maze', () => {
  it('every cell is reachable and entrance/exit are open (R = 3..10, 50 seeds, any exit column)', () => {
    for (let rows = 3; rows <= 10; rows++) {
      for (let seed = 0; seed < 50; seed++) {
        const exitC = seed % MAZE_COLS;
        const m = generateMaze(rows, 0.3, mulberry32(seed * 7919 + rows), exitC);
        expect(reachableCells(m)).toBe(rows * MAZE_COLS);
        expect(openSides(m, 2, 0)).toBeGreaterThanOrEqual(2); // entrance + at least one neighbor
        expect(openSides(m, exitC, rows - 1)).toBeGreaterThanOrEqual(2);
        const path = solutionPath(m);
        expect(path[0]).toEqual({ c: 2, r: 0 });
        expect(path[path.length - 1]).toEqual({ c: exitC, r: rows - 1 });
      }
    }
  });

  it('quiz mazes are trees with K spaced junctions (rows 6 and 8)', () => {
    for (const [rows, k] of [[6, 2], [8, 3]]) {
      let full = 0;
      for (let seed = 0; seed < 40; seed++) {
        const qm = generateQuizMaze(rows, k, mulberry32(seed), seed % MAZE_COLS, 2, 50);
        if (qm.junctions.length === k) full++;
        const idx = qm.junctions.map((j) => j.pathIndex);
        for (let i = 1; i < idx.length; i++) expect(idx[i] - idx[i - 1]).toBeGreaterThanOrEqual(2);
        for (const j of qm.junctions) {
          expect(j.pathIndex).toBeGreaterThan(0);
          expect(j.pathIndex).toBeLessThan(qm.path.length - 1);
          expect(j.wrong.every((w) => w.size >= 2)).toBe(true);
        }
      }
      expect(full).toBeGreaterThanOrEqual(36);
    }
  });

  it('braid with p = 1 leaves no dead ends', () => {
    for (let rows = 3; rows <= 7; rows++) {
      for (let seed = 0; seed < 50; seed++) {
        const m = generateMaze(rows, 1, mulberry32(seed + 1000 * rows));
        const bad = m.deadEnds.filter((e) => !(e.c === 2 && (e.r === 0 || e.r === rows - 1)));
        expect(bad).toEqual([]);
      }
    }
  });

  it('p = 0 keeps dead ends (mazes have dead ends)', () => {
    let total = 0;
    for (let seed = 0; seed < 20; seed++) total += generateMaze(5, 0, mulberry32(seed)).deadEnds.length;
    expect(total).toBeGreaterThan(20);
  });

  it('coins sit in dead ends, at most 3, never on entrance/exit cells', () => {
    for (let seed = 0; seed < 30; seed++) {
      const m = generateMaze(5, 0.15, mulberry32(seed));
      expect(m.coins.length).toBeLessThanOrEqual(3);
      for (const c of m.coins) {
        expect(m.deadEnds.some((e) => e.c === c.c && e.r === c.r)).toBe(true);
        expect(c.c === 2 && (c.r === 0 || c.r === 4)).toBe(false);
      }
    }
  });

  it('built walls never share identical bounds and never overlap', () => {
    for (let rows = 3; rows <= 6; rows++) {
      for (let seed = 0; seed < 20; seed++) {
        const rects = mazeRects(generateMaze(rows, 0.3, mulberry32(seed)));
        const keys = new Set(rects.map((r) => [r.lx0, r.lx1, r.d0, r.d1].map((v) => v.toFixed(4)).join(',')));
        expect(keys.size).toBe(rects.length);
        for (let i = 0; i < rects.length; i++) {
          for (let j = i + 1; j < rects.length; j++) {
            const a = rects[i], b = rects[j];
            const ox = Math.min(a.lx1, b.lx1) - Math.max(a.lx0, b.lx0);
            const od = Math.min(a.d1, b.d1) - Math.max(a.d0, b.d0);
            expect(ox > 1e-6 && od > 1e-6).toBe(false);
          }
        }
      }
    }
  });

  it('is deterministic for the same seed', () => {
    const a = generateMaze(5, 0.3, mulberry32(42)), b = generateMaze(5, 0.3, mulberry32(42));
    expect(a).toEqual(b);
  });
});
