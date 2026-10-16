import { beforeEach, describe, expect, it } from 'vitest';
import {
  DAILY_KEY, dailyRun, applyDailyRun, dailyDomain, dailySeed, dailySelection, decodeGhost, emptyDaily, encodeGhost, GhostRecorder,
  loadDaily, previousDate, pruneDays, saveDaily, streakAt, tracksSeen, utcDate, type DailyData,
} from '../game/daily';
import { engine } from '../game/engine';
import { useUI } from '../ui/store';
import { advance, boot, finish, steer } from './helpers';
import { sampleSnapshots, type Snapshot } from '../net/interp';
import { T } from '../game/tuning';

const mem = new Map<string, string>();
beforeEach(() => {
  mem.clear();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)); },
    removeItem: (k: string) => { mem.delete(k); },
    clear: () => mem.clear(), key: () => null, length: 0,
  } as Storage;
});

function walk(n: number): Snapshot[] {
  return Array.from({ length: n }, (_, i) => ({
    t: i * 100, x: Math.sin(i / 7) * 13.37123 + i * 0.0731, y: i % 9 === 0 ? 1.2345 : 0, z: -i * 0.3777 - 0.004,
    f: Math.sin(i / 11) * 3.1, sp: 7 * Math.abs(Math.sin(i / 5)), g: i % 9 !== 0, ...(i % 13 === 0 ? { spin: 0.5 } : {}),
  }));
}

describe('daily seed', () => {
  it('is stable per UTC date and differs across dates', () => {
    expect(dailySeed('2026-10-15')).toBe(dailySeed('2026-10-15'));
    expect(dailySeed('2026-10-15')).not.toBe(dailySeed('2026-10-16'));
    const sel = dailySelection('2026-10-15');
    expect(sel).toEqual(dailySelection('2026-10-15'));
    expect(sel.mode).toBe('daily');
    expect(sel.difficulty).toBe('normal');
  });
  it('uses the UTC date, whatever the local time zone', () => {
    expect(utcDate(Date.UTC(2026, 9, 15, 23, 59, 59))).toBe('2026-10-15');
    expect(utcDate(Date.UTC(2026, 9, 16, 0, 0, 0))).toBe('2026-10-16');
    expect(previousDate('2026-03-01')).toBe('2026-02-28');
    expect(previousDate('2026-01-01')).toBe('2025-12-31');
  });
  it('rotates the domain over four consecutive days', () => {
    const days = ['2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18'];
    expect(new Set(days.map(dailyDomain)).size).toBe(4);
    expect(dailyDomain('2026-10-19')).toBe(dailyDomain('2026-10-15'));
  });
  it('turns off seen-question tracking for daily and demo runs only', () => {
    expect(tracksSeen(dailySelection('2026-10-15'), false)).toBe(false);
    expect(tracksSeen({ domainId: 'math', difficulty: 'easy', seed: 1 }, true)).toBe(false);
    expect(tracksSeen({ domainId: 'math', difficulty: 'easy', seed: 1 }, false)).toBe(true);
  });
});

describe('ghost encoding', () => {
  it('round-trips to the centimetre', () => {
    const snaps = walk(400);
    const back = decodeGhost(JSON.parse(JSON.stringify(encodeGhost(snaps))));
    expect(back).toHaveLength(snaps.length);
    snaps.forEach((s, i) => {
      expect(back[i].t).toBe(s.t);
      expect(Math.abs(back[i].x - s.x)).toBeLessThanOrEqual(0.0051);
      expect(Math.abs(back[i].y - s.y)).toBeLessThanOrEqual(0.0051);
      expect(Math.abs(back[i].z - s.z)).toBeLessThanOrEqual(0.0051);
      expect(Math.abs(back[i].f - s.f)).toBeLessThanOrEqual(0.0051);
      expect(back[i].g).toBe(s.g);
      expect(back[i].spin ?? 0).toBeCloseTo(s.spin ?? 0, 2);
    });
  });
  it('stores small deltas, not absolute values', () => {
    const e = encodeGhost(walk(100));
    expect(Math.max(...e.x.slice(1).map(Math.abs))).toBeLessThan(200);
  });
  it('the recorder samples at 10 Hz of run time', () => {
    const rec = new GhostRecorder();
    const p = { pos: { x: 1, y: 0, z: 2 }, vel: { x: 3, z: 4 }, facing: 0.5, grounded: true, spin: 0 };
    for (let ms = 0; ms <= 1000; ms += 8) rec.tick(ms, p);
    expect(rec.snaps).toHaveLength(11);
    expect(rec.snaps[10].t).toBe(1000);
    expect(rec.snaps[0].sp).toBe(5);
  });
});

describe('daily storage', () => {
  const day = (ms: number) => ({ bestMs: ms, ghost: encodeGhost(walk(5)) });

  it('keeps only today and yesterday', () => {
    const data: DailyData = { days: { '2026-10-12': day(1), '2026-10-14': day(2), '2026-10-15': day(3), '2026-10-16': day(4) }, streak: null };
    expect(Object.keys(pruneDays(data, '2026-10-15').days).sort()).toEqual(['2026-10-14', '2026-10-15']);
    saveDaily(data);
    expect(Object.keys(loadDaily('2026-10-15').days).sort()).toEqual(['2026-10-14', '2026-10-15']);
    const after = applyDailyRun(data, '2026-10-15', true, 10, walk(3));
    expect(Object.keys(after.data.days).sort()).toEqual(['2026-10-14', '2026-10-15']);
  });

  it('keeps the best qualified attempt per day and reports the comparison', () => {
    let d = emptyDaily();
    let r = applyDailyRun(d, '2026-10-15', true, 90000, walk(10));
    expect(r.outcome).toMatchObject({ newBest: true, previousBestMs: null, streak: 1 });
    d = r.data;
    r = applyDailyRun(d, '2026-10-15', true, 95000, walk(20));
    expect(r.outcome).toMatchObject({ newBest: false, previousBestMs: 90000 });
    expect(r.data.days['2026-10-15'].bestMs).toBe(90000);
    expect(decodeGhost(r.data.days['2026-10-15'].ghost)).toHaveLength(10);
    r = applyDailyRun(r.data, '2026-10-15', false, 10000, walk(30));
    expect(r.data.days['2026-10-15'].bestMs).toBe(90000);
    r = applyDailyRun(r.data, '2026-10-15', true, 80000, walk(40));
    expect(r.outcome.newBest).toBe(true);
    expect(decodeGhost(r.data.days['2026-10-15'].ghost)).toHaveLength(40);
    expect(r.outcome.streak).toBe(1); // same day does not add to the streak
  });

  it('counts a streak over consecutive UTC days and resets after a gap', () => {
    let d = emptyDaily();
    d = applyDailyRun(d, '2026-10-13', true, 1000, walk(2)).data;
    d = applyDailyRun(d, '2026-10-14', true, 1000, walk(2)).data;
    d = applyDailyRun(d, '2026-10-15', true, 1000, walk(2)).data;
    expect(streakAt(d, '2026-10-15')).toBe(3);
    expect(streakAt(d, '2026-10-16')).toBe(3); // still alive: play today to extend it
    expect(streakAt(d, '2026-10-17')).toBe(0); // missed a day
    expect(applyDailyRun(d, '2026-10-17', true, 1000, walk(2)).outcome.streak).toBe(1);
    // an eliminated run does not extend it
    expect(applyDailyRun(d, '2026-10-16', false, 1000, walk(2)).outcome.streak).toBe(3);
    expect(applyDailyRun(d, '2026-10-16', false, 1000, walk(2)).data.streak?.last).toBe('2026-10-15');
  });

  it('survives corrupt storage', () => {
    mem.set(DAILY_KEY, '{nope');
    expect(loadDaily('2026-10-15')).toEqual(emptyDaily());
    mem.set(DAILY_KEY, JSON.stringify({ days: { '2026-10-15': { bestMs: 5, ghost: { hz: 10, x: [1] } } }, streak: 7 }));
    expect(loadDaily('2026-10-15')).toEqual(emptyDaily());
  });
});

describe('daily run in the engine', () => {
  it('records the ghost at 10 Hz of run time, stores a win, and does not touch the seen list', () => {
    const run = boot('normal', 1, 'math', { mode: 'daily' });
    steer(0, 1);
    advance(5);
    finish();
    const rec = dailyRun.recorder!;
    expect(rec).toBeTruthy();
    expect(Math.abs(rec.snaps.length - Math.floor(run.elapsedMs / 100) - 1)).toBeLessThanOrEqual(1);
    engine.debug.win();
    advance(T.RESULT_DELAY + 0.5);
    const today = utcDate();
    const day = loadDaily(today).days[today];
    expect(day?.bestMs).toBeGreaterThan(0);
    expect(decodeGhost(day.ghost).length).toBeGreaterThan(30);
    expect(mem.get('lywo:v1') ? JSON.parse(mem.get('lywo:v1')!).seen : []).toEqual([]);
    expect(useUI.getState().dailyOutcome?.newBest).toBe(true);
  });
});

describe('sampleSnapshots', () => {
  const s = (t: number, x: number, extra: Partial<Snapshot> = {}): Snapshot => ({ t, x, y: 0, z: 0, f: 0, sp: 0, g: true, ...extra });

  it('returns null for an empty buffer and holds the ends', () => {
    expect(sampleSnapshots([], 100)).toBeNull();
    const buf = [s(100, 1), s(200, 3)];
    expect(sampleSnapshots(buf, 0)?.x).toBe(1);
    expect(sampleSnapshots(buf, 250)?.x).toBe(3);
  });
  it('lerps between the two snapshots around the time', () => {
    const buf = [s(0, 0), s(100, 2), s(200, 6)];
    expect(sampleSnapshots(buf, 50)?.x).toBeCloseTo(1);
    expect(sampleSnapshots(buf, 150)?.x).toBeCloseTo(4);
    expect(sampleSnapshots(buf, 100)?.x).toBeCloseTo(2);
  });
  it('takes the shortest arc for facing', () => {
    const buf = [s(0, 0, { f: 3.0 }), s(100, 0, { f: -3.0 })];
    const mid = sampleSnapshots(buf, 50)!.f;
    expect(Math.abs(Math.abs(mid) - Math.PI)).toBeLessThan(0.15); // through +-PI, not through 0
    const buf2 = [s(0, 0, { f: 0.1 }), s(100, 0, { f: 0.5 })];
    expect(sampleSnapshots(buf2, 50)!.f).toBeCloseTo(0.3);
  });
  it('snaps instead of lerping across a jump over 6 m', () => {
    const buf = [s(0, 0), s(100, 20)];
    expect(sampleSnapshots(buf, 30)?.x).toBe(0);
    expect(sampleSnapshots(buf, 70)?.x).toBe(20);
    const near = [s(0, 0), s(100, 5)];
    expect(sampleSnapshots(near, 50)?.x).toBeCloseTo(2.5);
  });
  it('flags stale only after the last snapshot is older than the stale limit', () => {
    const buf = [s(0, 0), s(100, 1)];
    expect(sampleSnapshots(buf, 100 + T.STALE_MS - 1)?.stale).toBe(false);
    expect(sampleSnapshots(buf, 100 + T.STALE_MS + 1)?.stale).toBe(true);
    expect(sampleSnapshots(buf, 50)?.stale).toBe(false);
  });
  it('reuses the output object when given one', () => {
    const out = { x: 0, y: 0, z: 0, f: 0, sp: 0, g: true, spin: 0, stale: false };
    expect(sampleSnapshots([s(0, 0), s(100, 1)], 50, out)).toBe(out);
  });
});
