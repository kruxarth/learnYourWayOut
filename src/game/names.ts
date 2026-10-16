// Player names (plan/F1_AVATARS.md §6). Pure TS: the F3 server runs the same `cleanName`.
import { hasProfanity } from './profanity';

export const NAME_MIN = 2;
export const NAME_MAX = 16;

export type NameResult =
  | { ok: true; name: string }
  | { ok: false; reason: 'too-short' | 'too-long' | 'not-allowed' };

// control chars, zero-width chars, line/paragraph separators, bidi marks/embeddings/overrides/isolates, BOM, soft hyphen
const INVISIBLE_EXTRA = [0x2028, 0x2029, 0xad, 0x34f, 0x115f, 0x1160, 0x17b4, 0x17b5, 0x180e, 0x3164, 0xffa0].map((c) => String.fromCodePoint(c)).join('');
const INVISIBLE = new RegExp(`[\\p{Cc}\\p{Cf}${INVISIBLE_EXTRA}]`, 'gu');
const ALLOWED = /^[\p{L}\p{M}\p{N} _\-.']+$/u;

export function cleanName(raw: string): NameResult {
  let s = String(raw).normalize('NFKC').replace(/\s+/gu, ' ').replace(INVISIBLE, '');
  s = s.replace(/ {2,}/g, ' ').trim();
  const len = [...s].length;
  if (len < NAME_MIN) return { ok: false, reason: 'too-short' };
  if (len > NAME_MAX) return { ok: false, reason: 'too-long' };
  if (!ALLOWED.test(s) || !/[\p{L}\p{N}]/u.test(s)) return { ok: false, reason: 'not-allowed' };
  if (hasProfanity(s)) return { ok: false, reason: 'not-allowed' };
  return { ok: true, name: s };
}

export function nameError(reason: Exclude<NameResult, { ok: true }>['reason']): string {
  switch (reason) {
    case 'too-short': return 'Names need at least 2 characters.';
    case 'too-long': return 'Names can be up to 16 characters.';
    default: return 'Please use letters, numbers, spaces or _ - . only, and keep it friendly.';
  }
}

export const ADJECTIVES = [
  'Brave', 'Sunny', 'Curious', 'Clever', 'Happy', 'Swift', 'Gentle', 'Mighty', 'Jolly', 'Lucky',
  'Bouncy', 'Cosmic', 'Daring', 'Eager', 'Fuzzy', 'Giddy', 'Humble', 'Icy', 'Jazzy', 'Keen',
  'Lively', 'Merry', 'Nimble', 'Quick', 'Proud', 'Quiet', 'Rapid', 'Silly', 'Snappy', 'Sparky',
  'Speedy', 'Steady', 'Sweet', 'Tiny', 'Wise', 'Witty', 'Zany', 'Zesty', 'Bold', 'Bright',
  'Calm', 'Cheery', 'Cozy', 'Dashing', 'Fancy', 'Peppy', 'Zippy', 'Glowing', 'Golden', 'Grand',
  'Hasty', 'Lunar', 'Mellow', 'Plucky', 'Radiant', 'Shiny', 'Stellar', 'Sturdy', 'Wild', 'Wonder',
];

export const ANIMALS = [
  'Otter', 'Panda', 'Gecko', 'Fox', 'Koala', 'Falcon', 'Dolphin', 'Tiger', 'Rabbit', 'Penguin',
  'Badger', 'Beaver', 'Bison', 'Camel', 'Cheetah', 'Crane', 'Eagle', 'Ferret', 'Giraffe', 'Hedgehog',
  'Heron', 'Ibis', 'Jaguar', 'Kitten', 'Lemur', 'Llama', 'Lynx', 'Macaw', 'Marmot', 'Moose',
  'Narwhal', 'Newt', 'Ocelot', 'Owl', 'Parrot', 'Pelican', 'Puffin', 'Quokka', 'Raven', 'Robin',
  'Seal', 'Sloth', 'Sparrow', 'Squid', 'Stork', 'Swan', 'Toucan', 'Turtle', 'Walrus', 'Whale',
  'Wombat', 'Yak', 'Zebra', 'Alpaca', 'Bunny', 'Corgi', 'Duckling', 'Gazelle', 'Lizard', 'Mouse',
];

/** A friendly suggestion such as "Curious Otter". `rng` returns [0, 1). */
export function randomName(rng: () => number): string {
  const a = ADJECTIVES[Math.floor(rng() * ADJECTIVES.length) % ADJECTIVES.length];
  const b = ANIMALS[Math.floor(rng() * ANIMALS.length) % ANIMALS.length];
  return `${a} ${b}`;
}
