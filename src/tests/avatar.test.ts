import { describe, expect, it } from 'vitest';
import {
  ACHIEVEMENT_IDS, AVATAR_CATALOG, DEFAULT_AVATAR, EMPTY_PROGRESS, SLOTS, catalogFor, findItem, isUnlocked, parseAvatarParam,
  randomAvatar, sanitizeAvatar, type AvatarConfig, type Slot,
} from '../game/avatar';
import { BODY_COLORS, PAL } from '../game/palette';
import { mulberry32 } from '../game/rng';

describe('avatar catalog', () => {
  it('ids are unique per slot and the default config exists in the catalog', () => {
    for (const slot of SLOTS) {
      const ids = catalogFor(slot).map((c) => c.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(findItem(slot, DEFAULT_AVATAR[slot as keyof AvatarConfig] as string)).toBeDefined();
    }
  });

  it('every body colour has a catalog entry and a distinct hex; none equals hedge, floor or slime', () => {
    const hexes = Object.values(BODY_COLORS);
    expect(new Set(hexes).size).toBe(hexes.length);
    for (const id of Object.keys(BODY_COLORS)) expect(findItem('body', id)).toBeDefined();
    expect(catalogFor('body')).toHaveLength(hexes.length);
    for (const bad of [PAL.hedge, PAL.floorMaze, PAL.slime, PAL.hedgeTop]) expect(hexes).not.toContain(bad);
    expect(BODY_COLORS.pink).toBe(PAL.bean);
  });

  it('every achievement unlock references a real AchievementId', () => {
    for (const c of AVATAR_CATALOG) if (c.unlock.kind === 'achievement') expect(ACHIEVEMENT_IDS).toContain(c.unlock.id);
  });

  it('the free set gives at least 3 choices per slot', () => {
    for (const slot of SLOTS) {
      expect(catalogFor(slot).filter((c) => isUnlocked(c, EMPTY_PROGRESS)).length).toBeGreaterThanOrEqual(3);
    }
  });

  it('item names are short enough to label', () => {
    for (const c of AVATAR_CATALOG) expect(c.name.length).toBeLessThanOrEqual(22);
  });
});

describe('sanitizeAvatar', () => {
  it('returns the default for garbage and non-objects', () => {
    for (const x of [null, undefined, 5, 'str', [], true, () => 1]) expect(sanitizeAvatar(x)).toEqual(DEFAULT_AVATAR);
  });

  it('keeps valid ids, replaces unknown ones per slot, and tolerates a missing v', () => {
    const out = sanitizeAvatar({ body: 'red', eyes: 'nope', mouth: 7, hat: 'crown', extra: null });
    expect(out).toEqual({ ...DEFAULT_AVATAR, body: 'red', hat: 'crown' });
    expect(out.v).toBe(1);
  });

  it('does not accept ids that belong to another slot or prototype keys', () => {
    expect(sanitizeAvatar({ hat: 'red', body: 'crown', eyes: '__proto__' })).toEqual(DEFAULT_AVATAR);
  });

  it('parses the debug ?avatar= param', () => {
    expect(parseAvatarParam(null)).toBeNull();
    expect(parseAvatarParam('red.wide.grin.crown.cape')).toEqual({ v: 1, body: 'red', eyes: 'wide', mouth: 'grin', hat: 'crown', extra: 'cape' });
    expect(parseAvatarParam('blue')).toEqual({ ...DEFAULT_AVATAR, body: 'blue' });
  });
});

describe('randomAvatar', () => {
  it('only picks unlocked items', () => {
    const rng = mulberry32(5);
    for (let i = 0; i < 100; i++) {
      const a = randomAvatar(EMPTY_PROGRESS, rng);
      for (const slot of SLOTS as Slot[]) {
        const item = findItem(slot, a[slot as keyof AvatarConfig] as string)!;
        expect(isUnlocked(item, EMPTY_PROGRESS)).toBe(true);
      }
    }
  });
});
