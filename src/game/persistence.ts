import type { Settings } from '../ui/store';
import {
  ACHIEVEMENT_IDS, AVATAR_CATALOG, applyRun, coinPrice, isUnlocked, itemKey, sanitizeAvatar, unlocksAfterRun, type AchievementId, type AvatarConfig, type CatalogItem, type Progress,
} from './avatar';
import { cleanName } from './names';
import { params } from './urlParams';
import { T } from './tuning';
import type { Difficulty, DomainId, RunResult } from './types';

export interface SaveData {
  bestTimes: Partial<Record<DomainId, Partial<Record<Difficulty, number>>>>;
  runs: number;
  wins: number;
  settings: Settings;
  /** Question ids asked in earlier runs, newest last (capped). */
  seen: string[];
  /** F1: all optional; `loadSave` sanitises each one. */
  avatar?: AvatarConfig;
  playerName?: string;
  stars?: number;
  correctTotal?: number;
  weakRuns?: number;
  achievements?: AchievementId[];
  /** Coins banked from finished runs and not yet spent on outfits. */
  coinBank?: number;
  /** Outfits bought with coins (`slot:id`). */
  owned?: string[];
}

const KEY = 'lywo:v1';

export const DEFAULT_SETTINGS: Settings = {
  volume: 0.8, muted: false, readAloud: false, reducedMotion: false, showMinimap: true, camSens: 1, relaxedTimers: false, finale: 'gate',
};

function fresh(): SaveData {
  return { bestTimes: {}, runs: 0, wins: 0, settings: { ...DEFAULT_SETTINGS }, seen: [] };
}

function count(x: unknown): number {
  return typeof x === 'number' && Number.isFinite(x) && x > 0 ? Math.floor(x) : 0;
}

/** The cleaned name, or undefined when it no longer passes (the name prompt then shows again). */
function okName(raw: string): string | undefined {
  const r = cleanName(raw);
  return r.ok ? r.name : undefined;
}

/** Every read and write is wrapped in try/catch: the game works without storage. */
export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh();
    const d = JSON.parse(raw) as Partial<SaveData>;
    return {
      bestTimes: d.bestTimes ?? {}, runs: d.runs ?? 0, wins: d.wins ?? 0,
      settings: { ...DEFAULT_SETTINGS, ...(d.settings ?? {}), finale: d.settings?.finale === 'hex' ? 'hex' : 'gate' },
      seen: Array.isArray(d.seen) ? d.seen.filter((x): x is string => typeof x === 'string') : [],
      avatar: sanitizeAvatar(d.avatar),
      playerName: typeof d.playerName === 'string' ? okName(d.playerName) : undefined,
      stars: count(d.stars), correctTotal: count(d.correctTotal), weakRuns: count(d.weakRuns),
      achievements: Array.isArray(d.achievements)
        ? ACHIEVEMENT_IDS.filter((id) => (d.achievements as unknown[]).includes(id)) : [],
      coinBank: count(d.coinBank),
      owned: Array.isArray(d.owned) ? AVATAR_CATALOG.map(itemKey).filter((k) => (d.owned as unknown[]).includes(k)) : [],
    };
  } catch {
    return fresh();
  }
}

export function writeSave(data: SaveData): void {
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* storage unavailable */ }
}

export function saveSettings(settings: Settings): void {
  const d = loadSave();
  d.settings = settings;
  writeSave(d);
}

export function saveAvatar(avatar: AvatarConfig): void {
  const d = loadSave();
  d.avatar = sanitizeAvatar(avatar);
  writeSave(d);
}

export function savePlayerName(name: string): void {
  const d = loadSave();
  d.playerName = okName(name);
  writeSave(d);
}

function progressOf(d: SaveData): Progress {
  return { stars: d.stars ?? 0, correctTotal: d.correctTotal ?? 0, weakRuns: d.weakRuns ?? 0, achievements: d.achievements ?? [], owned: d.owned ?? [] };
}

export function loadProgress(): Progress {
  return progressOf(loadSave());
}

/** Coins banked across runs and still unspent. */
export function loadCoinBank(): number {
  return loadSave().coinBank ?? 0;
}

/** Spend banked coins on a locked outfit. False (nothing changes) when it is already open or too dear. */
export function buyItem(item: CatalogItem): boolean {
  const d = loadSave();
  const price = coinPrice(item);
  if (isUnlocked(item, progressOf(d)) || (d.coinBank ?? 0) < price) return false;
  d.coinBank = (d.coinBank ?? 0) - price;
  d.owned = [...(d.owned ?? []), itemKey(item)];
  writeSave(d);
  return true;
}

/**
 * Count the run, keep the best qualified time per domain and difficulty, and update stars, achievements and the coin bank.
 * Returns the cosmetics this run unlocked. Demo runs (`?demo=1`) change nothing about progress.
 */
export function recordRun(result: RunResult, demo: boolean = params.demo): CatalogItem[] {
  const d = loadSave();
  const before = progressOf(d);
  let unlocked: CatalogItem[] = [];
  if (!demo) {
    const after = applyRun(before, result);
    d.stars = after.stars; d.correctTotal = after.correctTotal; d.weakRuns = after.weakRuns; d.achievements = after.achievements;
    d.coinBank = (d.coinBank ?? 0) + result.coinsCollected;
    unlocked = unlocksAfterRun(before, after);
  }
  d.runs++;
  if (result.outcome === 'qualified') {
    d.wins++;
    if (result.selection.domainId === 'custom') { writeSave(d); return unlocked; } // no best times for Any Topic packs
    const { domainId, difficulty } = result.selection;
    const per = d.bestTimes[domainId] ?? (d.bestTimes[domainId] = {});
    if (per[difficulty] === undefined || result.timeMs < per[difficulty]!) per[difficulty] = result.timeMs;
  }
  writeSave(d);
  return unlocked;
}

/** Any Topic ids ('custom-rise-001') repeat across different topics, so they are never tracked. */
const trackable = (id: string) => !id.startsWith('custom-');

export function loadSeen(): Set<string> {
  return new Set(loadSave().seen.filter(trackable));
}

/** Append this run's question ids to the seen list (deduplicated, newest last, capped). */
export function rememberSeen(ids: Iterable<string>): void {
  const d = loadSave();
  const fresh = [...ids].filter(trackable);
  if (!fresh.length) return;
  const set = new Set(fresh);
  d.seen = [...d.seen.filter((x) => !set.has(x)), ...fresh].slice(-T.SEEN_MAX);
  writeSave(d);
}

/** Best time for a domain at any difficulty (ms), or null. */
export function bestTimeFor(domainId: DomainId): number | null {
  const per = loadSave().bestTimes[domainId];
  if (!per) return null;
  const vals = Object.values(per).filter((v): v is number => typeof v === 'number');
  return vals.length ? Math.min(...vals) : null;
}

export function formatTime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
