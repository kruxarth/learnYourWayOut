import type { DomainId, Difficulty } from './types';

export interface UrlParams {
  seed: number | null;
  domain: DomainId | null;
  difficulty: Difficulty | null;
  demo: boolean;
  debug: boolean;
  arena: boolean;
  /** Debug only: `?avatar=body.eyes.mouth.hat.extra`, parsed with parseAvatarParam. */
  avatar: string | null;
}

const DOMAINS: DomainId[] = ['math', 'science', 'history', 'programming'];
const DIFFS: Difficulty[] = ['easy', 'normal', 'hard'];

export function parseUrlParams(search: string): UrlParams {
  const q = new URLSearchParams(search);
  const seedRaw = q.get('seed');
  const seed = seedRaw !== null && /^-?\d+$/.test(seedRaw) ? parseInt(seedRaw, 10) : null;
  const d = q.get('domain');
  const f = q.get('difficulty');
  return {
    seed,
    domain: d && (DOMAINS as string[]).includes(d) ? (d as DomainId) : null,
    difficulty: f && (DIFFS as string[]).includes(f) ? (f as Difficulty) : null,
    demo: q.get('demo') === '1',
    debug: q.get('debug') === '1',
    arena: q.get('arena') === '1',
    avatar: q.get('avatar'),
  };
}

export const params: UrlParams = parseUrlParams(typeof window !== 'undefined' ? window.location.search : '');
