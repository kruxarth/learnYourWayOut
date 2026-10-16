import type { DomainPack } from './schema';
import { validateDomainPack } from './validate';

/**
 * Recent Any Topic packs, kept in localStorage under their own key (packs are 30-50 KB each,
 * so they stay out of `lywo:v1`). Every read and write is wrapped in try/catch: the game works without storage.
 */

const KEY = 'lywo:packs:v1';
export const RECENT_MAX = 6;

interface Stored {
  recent: DomainPack[];
  /** Question ids the player reported, per pack key. Filtered out whenever that pack is loaded. */
  excluded: Record<string, string[]>;
}

function read(): Stored {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (!raw) return { recent: [], excluded: {} };
    const d = JSON.parse(raw) as Partial<Stored>;
    const recent = (Array.isArray(d.recent) ? d.recent : []).filter(
      (p): p is DomainPack => !!p && typeof p === 'object' && p.id === 'custom' && !!p.generated?.packKey && validateDomainPack(p).length === 0,
    );
    const excluded: Record<string, string[]> = {};
    if (d.excluded && typeof d.excluded === 'object') {
      for (const [k, v] of Object.entries(d.excluded)) if (Array.isArray(v)) excluded[k] = v.filter((x): x is string => typeof x === 'string');
    }
    return { recent: recent.slice(0, RECENT_MAX), excluded };
  } catch {
    return { recent: [], excluded: {} };
  }
}

function write(s: Stored): void {
  try { globalThis.localStorage?.setItem(KEY, JSON.stringify(s)); } catch { /* storage unavailable or full */ }
}

/** Newest first. Invalid or tampered packs are dropped. */
export function loadRecent(): DomainPack[] {
  const s = read();
  return s.recent.map((p) => applyExcluded(p, s.excluded[p.generated!.packKey] ?? []));
}

/** Remember a pack (newest first, deduplicated by pack key, at most 6). */
export function saveRecent(pack: DomainPack): void {
  const key = pack.generated?.packKey;
  if (!key) return;
  const s = read();
  s.recent = [pack, ...s.recent.filter((p) => p.generated!.packKey !== key)].slice(0, RECENT_MAX);
  write(s);
}

export function removeRecent(packKey: string): void {
  const s = read();
  s.recent = s.recent.filter((p) => p.generated!.packKey !== packKey);
  write(s);
}

/** Remember that a question was reported, and drop it from the stored copy of its pack. */
export function excludeQuestion(packKey: string, questionId: string): void {
  const s = read();
  const list = s.excluded[packKey] ?? [];
  if (!list.includes(questionId)) s.excluded[packKey] = [...list, questionId].slice(-200);
  s.recent = s.recent.map((p) => (p.generated!.packKey === packKey ? applyExcluded(p, [questionId]) : p));
  write(s);
}

export function excludedFor(packKey: string): string[] {
  return read().excluded[packKey] ?? [];
}

/**
 * Remove reported questions. A removal that would break the quotas is skipped,
 * because a pack that fails `validateDomainPack` cannot feed a run.
 */
export function applyExcluded(pack: DomainPack, ids: string[]): DomainPack {
  let out = pack;
  for (const id of ids) {
    if (!out.questions.some((q) => q.id === id)) continue;
    const next = { ...out, questions: out.questions.filter((q) => q.id !== id) };
    if (validateDomainPack(next).length === 0) out = next;
  }
  return out;
}
