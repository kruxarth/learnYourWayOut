import type { Snapshot } from '../net/interp';
import { hashString } from './rng';
import { T } from './tuning';
import { params } from './urlParams';
import type { DomainId, RunSelection } from './types';

/**
 * F4-D: the Daily Challenge. Everything here is outside the simulation: the engine never reads the ghost or
 * the clock while stepping. The date is read once, when a daily run is started (inject `now` to test).
 */

export const DAILY_KEY = 'lywo:daily:v1';
const DAILY_DOMAINS: DomainId[] = ['math', 'science', 'history', 'programming'];
const DAY_MS = 86400000;

// ───────────────────────── dates, seed, selection ─────────────────────────

/** UTC date `YYYY-MM-DD`. The only place the wall clock is read for the daily. */
export function utcDate(now: number | Date = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

function dayNumber(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

export function previousDate(date: string): string {
  return utcDate((dayNumber(date) - 1) * DAY_MS);
}

export function dailySeed(date: string): number {
  return hashString('daily:' + date);
}

/** Rotates math, science, history, programming by day. */
export function dailyDomain(date: string): DomainId {
  const n = dayNumber(date);
  return DAILY_DOMAINS[((n % DAILY_DOMAINS.length) + DAILY_DOMAINS.length) % DAILY_DOMAINS.length];
}

export function dailySelection(date: string = utcDate()): RunSelection {
  return { domainId: dailyDomain(date), difficulty: 'normal', seed: dailySeed(date), mode: 'daily' };
}

/**
 * Whether a run reads and writes the cross-run "seen questions" list. Off for `?demo=1` rehearsals and for
 * daily runs, so the questions are identical for everyone.
 */
export function tracksSeen(sel: RunSelection | null | undefined, demo: boolean = params.demo): boolean {
  return !demo && sel?.mode !== 'daily';
}

// ───────────────────────── ghost encoding ─────────────────────────

/** Delta-encoded ghost: positions in cm, facing in 1/100 rad, speed in cm/s, spin in 1/100. Sample i is at i * 1000 / GHOST_HZ ms. */
export interface EncodedGhost {
  hz: number;
  x: number[]; y: number[]; z: number[]; f: number[]; sp: number[]; s: number[];
  /** One '0'/'1' per sample: grounded. */
  g: string;
}

function deltas(vals: number[]): number[] {
  const out: number[] = [];
  let prev = 0;
  for (const v of vals) { out.push(v - prev); prev = v; }
  return out;
}

function undelta(d: number[]): number[] {
  const out: number[] = [];
  let acc = 0;
  for (const v of d) { acc += v; out.push(acc); }
  return out;
}

const cm = (v: number): number => Math.round(v * 100);

export function encodeGhost(snaps: readonly Snapshot[], hz: number = T.GHOST_HZ): EncodedGhost {
  return {
    hz,
    x: deltas(snaps.map((s) => cm(s.x))), y: deltas(snaps.map((s) => cm(s.y))), z: deltas(snaps.map((s) => cm(s.z))),
    f: deltas(snaps.map((s) => cm(s.f))), sp: deltas(snaps.map((s) => cm(s.sp))), s: deltas(snaps.map((s) => cm(s.spin ?? 0))),
    g: snaps.map((s) => (s.g ? '1' : '0')).join(''),
  };
}

export function decodeGhost(e: EncodedGhost): Snapshot[] {
  const x = undelta(e.x), y = undelta(e.y), z = undelta(e.z), f = undelta(e.f), sp = undelta(e.sp), s = undelta(e.s);
  const step = 1000 / e.hz;
  return x.map((_, i) => {
    const snap: Snapshot = { t: i * step, x: x[i] / 100, y: y[i] / 100, z: z[i] / 100, f: f[i] / 100, sp: sp[i] / 100, g: e.g[i] === '1' };
    if (s[i]) snap.spin = s[i] / 100;
    return snap;
  });
}

function validGhost(e: unknown): e is EncodedGhost {
  if (!e || typeof e !== 'object') return false;
  const g = e as Record<string, unknown>;
  const arr = (k: string) => Array.isArray(g[k]) && (g[k] as unknown[]).every((v) => typeof v === 'number' && Number.isFinite(v));
  if (typeof g.hz !== 'number' || !(g.hz > 0) || typeof g.g !== 'string') return false;
  if (!(['x', 'y', 'z', 'f', 'sp', 's'] as const).every(arr)) return false;
  const n = (g.x as unknown[]).length;
  return (['y', 'z', 'f', 'sp', 's'] as const).every((k) => (g[k] as unknown[]).length === n) && g.g.length === n;
}

/** Records the player at GHOST_HZ of run time. Write-only from the engine's point of view. */
export class GhostRecorder {
  readonly snaps: Snapshot[] = [];
  private readonly stepMs = 1000 / T.GHOST_HZ;

  tick(elapsedMs: number, p: { pos: { x: number; y: number; z: number }; vel: { x: number; z: number }; facing: number; grounded: boolean; spin: number }): void {
    while (this.snaps.length * this.stepMs <= elapsedMs) {
      this.snaps.push({
        t: this.snaps.length * this.stepMs, x: p.pos.x, y: p.pos.y, z: p.pos.z, f: p.facing,
        sp: Math.hypot(p.vel.x, p.vel.z), g: p.grounded, ...(p.spin > 0 ? { spin: 1 - p.spin / 0.5 } : {}),
      });
    }
  }
}

// ───────────────────────── stored data ─────────────────────────

export interface DailyDay { bestMs: number; ghost: EncodedGhost }
export interface DailyData {
  /** Today and yesterday only. */
  days: Record<string, DailyDay>;
  /** Consecutive UTC days with a qualified daily; `last` is the latest such day. */
  streak: { last: string; count: number } | null;
}

export function emptyDaily(): DailyData { return { days: {}, streak: null }; }

/** Drop every day except `today` and yesterday. */
export function pruneDays(data: DailyData, today: string): DailyData {
  const keep = new Set([today, previousDate(today)]);
  const days: DailyData['days'] = {};
  for (const k of Object.keys(data.days)) if (keep.has(k)) days[k] = data.days[k];
  return { ...data, days };
}

/** The streak to show: alive only when the last qualified day is today or yesterday. */
export function streakAt(data: DailyData, today: string): number {
  const s = data.streak;
  if (!s) return 0;
  return s.last === today || s.last === previousDate(today) ? s.count : 0;
}

export interface DailyOutcome {
  /** A qualified run that beat (or set) today's best. */
  newBest: boolean;
  /** Today's best time before this run, if any. */
  previousBestMs: number | null;
  streak: number;
}

/**
 * Pure: fold a finished daily run into the stored data. Only qualified runs count; the fastest per day keeps its ghost.
 */
export function applyDailyRun(
  data: DailyData, today: string, qualified: boolean, timeMs: number, ghost: readonly Snapshot[],
): { data: DailyData; outcome: DailyOutcome } {
  const prev = data.days[today]?.bestMs ?? null;
  if (!qualified) return { data: pruneDays(data, today), outcome: { newBest: false, previousBestMs: prev, streak: streakAt(data, today) } };
  const next: DailyData = { ...data, days: { ...data.days } };
  const newBest = prev === null || timeMs < prev;
  if (newBest) next.days[today] = { bestMs: timeMs, ghost: encodeGhost(ghost) };
  const s = data.streak;
  if (!s || (s.last !== today && s.last !== previousDate(today))) next.streak = { last: today, count: 1 };
  else if (s.last === previousDate(today)) next.streak = { last: today, count: s.count + 1 };
  const pruned = pruneDays(next, today);
  return { data: pruned, outcome: { newBest, previousBestMs: prev, streak: streakAt(pruned, today) } };
}

function sanitize(raw: unknown): DailyData {
  const out = emptyDaily();
  if (!raw || typeof raw !== 'object') return out;
  const d = raw as Partial<DailyData>;
  if (d.days && typeof d.days === 'object') {
    for (const [k, v] of Object.entries(d.days)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || !v || typeof v.bestMs !== 'number' || !(v.bestMs > 0) || !validGhost(v.ghost)) continue;
      out.days[k] = { bestMs: v.bestMs, ghost: v.ghost };
    }
  }
  const s = d.streak;
  if (s && typeof s.last === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s.last) && typeof s.count === 'number' && s.count >= 1) {
    out.streak = { last: s.last, count: Math.floor(s.count) };
  }
  return out;
}

/** Every read and write is wrapped in try/catch: the game works without storage. */
export function loadDaily(today: string = utcDate()): DailyData {
  try {
    const raw = localStorage.getItem(DAILY_KEY);
    return pruneDays(raw ? sanitize(JSON.parse(raw)) : emptyDaily(), today);
  } catch {
    return emptyDaily();
  }
}

export function saveDaily(data: DailyData): void {
  try { localStorage.setItem(DAILY_KEY, JSON.stringify(data)); } catch { /* storage unavailable */ }
}

// ───────────────────────── runtime glue ─────────────────────────

/** Mutable daily-run state for the engine (recording) and the renderer (playback). Not part of RunState. */
export const dailyRun = {
  recorder: null as GhostRecorder | null,
  /** Today's best ghost, decoded at run start. */
  ghost: [] as Snapshot[],
  ghostMs: null as number | null,
};

export function beginDailyRun(sel: RunSelection, today: string = utcDate()): void {
  if (sel.mode !== 'daily') { dailyRun.recorder = null; dailyRun.ghost = []; dailyRun.ghostMs = null; return; }
  const day = loadDaily(today).days[today];
  dailyRun.recorder = new GhostRecorder();
  dailyRun.ghost = day ? decodeGhost(day.ghost) : [];
  dailyRun.ghostMs = day ? day.bestMs : null;
}

/** Called when a daily run ends. Saves and returns the outcome (null when this was not a daily run). */
export function finishDailyRun(qualified: boolean, timeMs: number, today: string = utcDate()): DailyOutcome | null {
  const rec = dailyRun.recorder;
  if (!rec) return null;
  dailyRun.recorder = null;
  const { data, outcome } = applyDailyRun(loadDaily(today), today, qualified, timeMs, rec.snaps);
  saveDaily(data);
  return outcome;
}

/** Hub summary: today's domain, the best time and the streak. */
export function dailySummary(today: string = utcDate()): { domain: DomainId; bestMs: number | null; streak: number } {
  const data = loadDaily(today);
  return { domain: dailyDomain(today), bestMs: data.days[today]?.bestMs ?? null, streak: streakAt(data, today) };
}
