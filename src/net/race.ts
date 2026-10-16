// Pure helpers for the online race UI (plan/F3 §5 HUD and §6 results). No React, no clocks, no randomness.
import { T } from '../game/tuning';
import type { Standing } from './protocol';

/** The last room of an online race: 3 or more racers play the Hex Finale, fewer the Slime Gate. Same input, same answer on every laptop. */
export function finaleFor(players: number | undefined): 'gate' | 'hex' {
  return typeof players === 'number' && Number.isFinite(players) && players >= T.HEX_MIN_PLAYERS ? 'hex' : 'gate';
}

/** The four emotes, in protocol id order (keys 6-9). */
export const EMOTES = [
  { id: 0, icon: '👋', label: 'Wave', key: '6' },
  { id: 1, icon: '👍', label: 'Thumbs up', key: '7' },
  { id: 2, icon: '😄', label: 'Smile', key: '8' },
  { id: 3, icon: 'GG', label: 'Good game', key: '9' },
] as const;

export const EMOTE_KEY_CODES = ['Digit6', 'Digit7', 'Digit8', 'Digit9'] as const;

/** The emote id for a key code, or -1. */
export function emoteForKey(code: string): number {
  return (EMOTE_KEY_CODES as readonly string[]).indexOf(code);
}

/** May an emote be sent now? `lastAt` is the time of the previous one (or null). */
export function emoteReady(lastAt: number | null, now: number): boolean {
  return lastAt === null || now - lastAt >= T.EMOTE_COOLDOWN_MS || now < lastAt;
}

/** Name-tag text: trimmed and cut to `max` characters with an ellipsis. */
export function nameTagText(name: string, max = 12): string {
  const t = name.trim().replace(/\s+/g, ' ') || 'Player';
  const chars = [...t];
  return chars.length <= max ? t : `${chars.slice(0, max - 1).join('')}…`;
}

/** Dark or white text for a tag in this body colour. */
export function tagTextColor(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.6 ? '#2B2D42' : '#FFFFFF';
}

const accuracy = (s: { asked: number; correct: number }): number => (s.asked > 0 ? s.correct / s.asked : 0);

/** Qualified first by time, then everyone else by rooms solved, then accuracy, then name (stable). Places are renumbered 1..n. */
export function sortStandings(list: readonly Standing[]): Standing[] {
  const rank = (s: Standing) => (s.outcome === 'qualified' ? 0 : 1);
  return [...list]
    .sort((a, b) => rank(a) - rank(b)
      || (rank(a) === 0 ? a.timeMs - b.timeMs : b.solved - a.solved || accuracy(b) - accuracy(a))
      || a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    .map((s, i) => ({ ...s, place: i + 1 }));
}

/** Per-player numbers the standings do not carry; tracked from the state feed. */
export interface RaceStat { bestCombo: number; detours: number }

export interface Award { id: 'brainiest' | 'streak' | 'comeback'; icon: string; title: string; playerId: string; note: string }

/** Awards that reward learning (plan/F3 §6). Each goes to one player (ties go to the better finisher); none when nobody earns it. */
export function computeAwards(sorted: readonly Standing[], stats: Readonly<Record<string, RaceStat>>): Award[] {
  const out: Award[] = [];
  let brain: Standing | null = null;
  for (const s of sorted) {
    if (s.asked < T.AWARD_MIN_ASKED) continue;
    if (!brain || accuracy(s) > accuracy(brain)) brain = s;
  }
  if (brain) out.push({ id: 'brainiest', icon: '🧠', title: 'Brainiest', playerId: brain.id, note: `${brain.correct}/${brain.asked} right first try` });

  let streak: Standing | null = null, best = 0;
  for (const s of sorted) {
    const c = stats[s.id]?.bestCombo ?? 0;
    if (c >= T.AWARD_MIN_COMBO && c > best) { streak = s; best = c; }
  }
  if (streak) out.push({ id: 'streak', icon: '🔥', title: 'Hot Streak', playerId: streak.id, note: `${best} in a row` });

  let comeback: Standing | null = null, most = 0;
  for (const s of sorted) {
    const d = stats[s.id]?.detours ?? 0;
    if (s.outcome === 'qualified' && d > most) { comeback = s; most = d; }
  }
  if (comeback) out.push({ id: 'comeback', icon: '🎯', title: 'Comeback', playerId: comeback.id, note: `${most} detour${most === 1 ? '' : 's'} and still qualified` });
  return out;
}

export interface Racer {
  id: string;
  name: string;
  me: boolean;
  /** Body colour for the dot. */
  color: string;
  solved: number;
  seg: number;
  /** null while running. */
  outcome: 'qualified' | 'eliminated' | null;
  finishMs: number;
  connected: boolean;
}

/** Live order for the RaceStrip: qualified (by time) first, then by rooms solved, then segment; eliminated sink below runners. */
export function rankRacers(list: readonly Racer[]): Racer[] {
  const grp = (r: Racer) => (r.outcome === 'qualified' ? 0 : r.outcome === null ? 1 : 2);
  return [...list].sort((a, b) => grp(a) - grp(b)
    || (grp(a) === 0 ? a.finishMs - b.finishMs : b.solved - a.solved || b.seg - a.seg)
    || a.id.localeCompare(b.id));
}

/** 1 -> "1st", 12 -> "12th". */
export function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}
