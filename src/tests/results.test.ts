import { beforeEach, describe, expect, it } from 'vitest';
import { win } from '../game/loop/outcome';
import { loadProgress } from '../game/persistence';
import { T } from '../game/tuning';
import { useUI } from '../ui/store';
import { advance, boot, finish } from './helpers';

const mem = new Map<string, string>();
beforeEach(() => {
  mem.clear();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)); },
    removeItem: (k: string) => { mem.delete(k); },
    clear: () => mem.clear(),
    key: () => null,
    length: 0,
  } as Storage;
});

describe('results flow', () => {
  it('winning a run records progress and hands the unlocks to the results card', () => {
    boot('easy', 77, 'math');
    win();
    advance(T.RESULT_DELAY + 0.5);
    const ui = useUI.getState();
    expect(ui.screen).toBe('results');
    expect(ui.results?.outcome).toBe('qualified');
    expect(ui.newUnlocks.map((c) => c.id)).toContain('grad');
    expect(loadProgress().achievements).toContain('qualify_math');
    finish();
  });
});
