// Avatar data (pure TS, no React). Catalog, sanitising and unlock rules (spec plan/F1_AVATARS.md §3).
import type { DomainId, RunResult } from './types';

export type BodyColorId = 'pink' | 'red' | 'orange' | 'yellow' | 'lime' | 'teal' | 'sky' | 'blue' | 'purple' | 'brown' | 'white' | 'black';
export type EyesId = 'round' | 'happy' | 'sleepy' | 'wide' | 'wink' | 'glasses';
export type MouthId = 'smile' | 'grin' | 'o' | 'none';
export type HatId = 'none' | 'cap' | 'beanie' | 'propeller' | 'grad' | 'crown' | 'laurel' | 'goggles' | 'headphones' | 'wizard' | 'flower' | 'chef';
export type ExtraId = 'none' | 'scarf' | 'bowtie' | 'bookbag' | 'cape';
export type Slot = 'body' | 'eyes' | 'mouth' | 'hat' | 'extra';

export interface AvatarConfig { v: 1; body: BodyColorId; eyes: EyesId; mouth: MouthId; hat: HatId; extra: ExtraId }
export const DEFAULT_AVATAR: AvatarConfig = { v: 1, body: 'pink', eyes: 'round', mouth: 'smile', hat: 'none', extra: 'none' };

export type AchievementId =
  | 'qualify_math' | 'qualify_science' | 'qualify_history' | 'qualify_programming' | 'qualify_custom'
  | 'hard_3star' | 'correct_50' | 'weak_3';

export const ACHIEVEMENT_IDS: AchievementId[] = [
  'qualify_math', 'qualify_science', 'qualify_history', 'qualify_programming', 'qualify_custom', 'hard_3star', 'correct_50', 'weak_3',
];

/** Lifetime counters that unlocks are computed from. */
export interface Progress { stars: number; correctTotal: number; weakRuns: number; achievements: AchievementId[] }
export const EMPTY_PROGRESS: Progress = { stars: 0, correctTotal: 0, weakRuns: 0, achievements: [] };

export type Unlock =
  | { kind: 'free' }
  | { kind: 'stars'; n: number }
  | { kind: 'achievement'; id: AchievementId };

export interface CatalogItem { slot: Slot; id: string; name: string; unlock: Unlock }

const free: Unlock = { kind: 'free' };
const stars = (n: number): Unlock => ({ kind: 'stars', n });
const ach = (id: AchievementId): Unlock => ({ kind: 'achievement', id });
const it = (slot: Slot, id: string, name: string, unlock: Unlock = free): CatalogItem => ({ slot, id, name, unlock });

export const AVATAR_CATALOG: CatalogItem[] = [
  it('body', 'pink', 'Pink'), it('body', 'red', 'Red'), it('body', 'orange', 'Orange'), it('body', 'yellow', 'Yellow'),
  it('body', 'lime', 'Lime'), it('body', 'teal', 'Teal'), it('body', 'sky', 'Sky blue'), it('body', 'blue', 'Blue'),
  it('body', 'purple', 'Purple'), it('body', 'brown', 'Brown'), it('body', 'white', 'White'), it('body', 'black', 'Black'),
  it('eyes', 'round', 'Round'), it('eyes', 'happy', 'Happy'), it('eyes', 'sleepy', 'Sleepy'),
  it('eyes', 'wide', 'Wide', stars(10)), it('eyes', 'wink', 'Wink', stars(15)), it('eyes', 'glasses', 'Glasses', ach('correct_50')),
  it('mouth', 'smile', 'Smile'), it('mouth', 'grin', 'Grin'), it('mouth', 'o', 'Oh!'), it('mouth', 'none', 'No mouth'),
  it('hat', 'none', 'No hat'), it('hat', 'cap', 'Cap'), it('hat', 'beanie', 'Beanie'),
  it('hat', 'propeller', 'Propeller hat', stars(3)), it('hat', 'grad', 'Graduation cap', ach('qualify_math')),
  it('hat', 'crown', 'Crown', ach('hard_3star')), it('hat', 'laurel', 'Laurel wreath', ach('qualify_history')),
  it('hat', 'goggles', 'Goggles', ach('qualify_science')), it('hat', 'headphones', 'Headphones', ach('qualify_programming')),
  it('hat', 'wizard', 'Wizard hat', ach('qualify_custom')), it('hat', 'flower', 'Flower', stars(40)), it('hat', 'chef', 'Chef hat', stars(25)),
  it('extra', 'none', 'Nothing'), it('extra', 'scarf', 'Scarf'),
  // Deviation from the spec table: bowtie is free so the free set has 3 extras (see docs/DECISIONS.md).
  it('extra', 'bowtie', 'Bow tie'),
  it('extra', 'bookbag', 'Book bag', ach('weak_3')), it('extra', 'cape', 'Cape', stars(60)),
];

export const SLOTS: Slot[] = ['body', 'eyes', 'mouth', 'hat', 'extra'];

export function catalogFor(slot: Slot): CatalogItem[] {
  return AVATAR_CATALOG.filter((c) => c.slot === slot);
}

export function findItem(slot: Slot, id: string): CatalogItem | undefined {
  return AVATAR_CATALOG.find((c) => c.slot === slot && c.id === id);
}

/** Unknown, missing or non-string ids fall back to the default for that slot. Never throws. */
export function sanitizeAvatar(x: unknown): AvatarConfig {
  const out: AvatarConfig = { ...DEFAULT_AVATAR };
  if (!x || typeof x !== 'object') return out;
  const o = x as Record<string, unknown>;
  for (const slot of SLOTS) {
    const v = o[slot];
    if (typeof v === 'string' && findItem(slot, v)) (out as unknown as Record<string, string>)[slot] = v;
  }
  return out;
}

/** Parse the debug `?avatar=body.eyes.mouth.hat.extra` param. Missing parts keep their default. */
export function parseAvatarParam(s: string | null): AvatarConfig | null {
  if (!s) return null;
  const [body, eyes, mouth, hat, extra] = s.split('.');
  return sanitizeAvatar({ body, eyes, mouth, hat, extra });
}

export function isUnlocked(item: CatalogItem, p: Progress): boolean {
  const u = item.unlock;
  if (u.kind === 'free') return true;
  if (u.kind === 'stars') return p.stars >= u.n;
  return p.achievements.includes(u.id);
}

/** Human text for a locked item, e.g. "Qualify in History". */
export function unlockText(u: Unlock): string {
  if (u.kind === 'free') return 'Free';
  if (u.kind === 'stars') return `Earn ${u.n} stars`;
  switch (u.id) {
    case 'qualify_math': return 'Qualify in Math';
    case 'qualify_science': return 'Qualify in Science';
    case 'qualify_history': return 'Qualify in History';
    case 'qualify_programming': return 'Qualify in Programming';
    case 'qualify_custom': return 'Qualify on an Any Topic run';
    case 'hard_3star': return 'Get 3 stars on Hard';
    case 'correct_50': return 'Answer 50 questions right';
    case 'weak_3': return 'Finish 3 weak-spot runs';
  }
}

/** Items that were locked before and are unlocked after (for the "new item!" toast). */
export function unlocksAfterRun(before: Progress, after: Progress): CatalogItem[] {
  return AVATAR_CATALOG.filter((c) => !isUnlocked(c, before) && isUnlocked(c, after));
}

/** Pick a random config from unlocked items only. `rng` returns [0, 1). */
export function randomAvatar(p: Progress, rng: () => number): AvatarConfig {
  const out: AvatarConfig = { ...DEFAULT_AVATAR };
  for (const slot of SLOTS) {
    const open = catalogFor(slot).filter((c) => isUnlocked(c, p));
    (out as unknown as Record<string, string>)[slot] = open[Math.floor(rng() * open.length) % open.length].id;
  }
  return out;
}

// ───────────────────────── progress ─────────────────────────

const QUALIFY_BY_DOMAIN: Record<DomainId, AchievementId> = {
  math: 'qualify_math', science: 'qualify_science', history: 'qualify_history', programming: 'qualify_programming', custom: 'qualify_custom',
};

export function runCorrect(result: RunResult): number {
  return result.mastery.reduce((n, m) => n + m.correct, 0);
}

/** Progress counters after this run (pure; leaves achievements alone). */
export function addRun(before: Progress, result: RunResult): Progress {
  return {
    ...before,
    stars: before.stars + result.stars,
    correctTotal: before.correctTotal + runCorrect(result),
    weakRuns: before.weakRuns + (result.selection.focusConcepts?.length ? 1 : 0),
  };
}

/** Achievements this run newly earns, given the progress before it. */
export function achievementsAfterRun(before: Progress, result: RunResult): AchievementId[] {
  const after = addRun(before, result);
  const got: AchievementId[] = [];
  if (result.outcome === 'qualified') {
    got.push(QUALIFY_BY_DOMAIN[result.selection.domainId]);
    if (result.selection.difficulty === 'hard' && result.stars === 3) got.push('hard_3star');
  }
  if (after.correctTotal >= 50) got.push('correct_50');
  if (after.weakRuns >= 3) got.push('weak_3');
  return got.filter((a) => !before.achievements.includes(a));
}

/** The full progress update for one finished run. */
export function applyRun(before: Progress, result: RunResult): Progress {
  const after = addRun(before, result);
  after.achievements = [...before.achievements, ...achievementsAfterRun(before, result)];
  return after;
}
