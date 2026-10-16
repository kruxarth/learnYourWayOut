import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_AVATAR, coinPrice, findItem, isUnlocked } from '../game/avatar';
import { engine } from '../game/engine';
import { stepBooths } from '../game/loop/selection';
import { teleport } from '../game/loop/navigation';
import { buyItem, loadCoinBank, loadProgress, loadSave, recordRun, saveAvatar, savePlayerName } from '../game/persistence';
import { G } from '../game/state';
import { useUI } from '../ui/store';
import { advance, fakeResult, finish } from './helpers';


const KEY = 'lywo:v1';
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

describe('save data', () => {
  it('an old v1 save without the F1 fields loads with defaults', () => {
    mem.set(KEY, JSON.stringify({ bestTimes: { math: { easy: 5000 } }, runs: 3, wins: 2, settings: { volume: 0.3 }, seen: ['a'] }));
    const d = loadSave();
    expect(d.runs).toBe(3);
    expect(d.bestTimes.math?.easy).toBe(5000);
    expect(d.avatar).toEqual(DEFAULT_AVATAR);
    expect(d.playerName).toBeUndefined();
    expect(loadProgress()).toEqual({ stars: 0, correctTotal: 0, weakRuns: 0, achievements: [], owned: [] });
  });

  it('an empty or corrupt save does not throw', () => {
    expect(loadSave().avatar ?? DEFAULT_AVATAR).toEqual(DEFAULT_AVATAR);
    mem.set(KEY, '{nope');
    expect(() => loadSave()).not.toThrow();
  });

  it('sanitises bad F1 fields', () => {
    mem.set(KEY, JSON.stringify({
      avatar: { body: 'red', hat: 'bogus', eyes: 4 }, playerName: 'fuck', stars: -4, correctTotal: 'x',
      achievements: ['qualify_math', 'made_up', 7],
    }));
    const d = loadSave();
    expect(d.avatar).toEqual({ ...DEFAULT_AVATAR, body: 'red' });
    expect(d.playerName).toBeUndefined();
    expect(d.stars).toBe(0);
    expect(d.correctTotal).toBe(0);
    expect(d.achievements).toEqual(['qualify_math']);
  });

  it('avatar and name survive a reload', () => {
    saveAvatar({ ...DEFAULT_AVATAR, body: 'teal', hat: 'beanie' });
    savePlayerName('  Brave   Otter ');
    const d = loadSave();
    expect(d.avatar).toMatchObject({ body: 'teal', hat: 'beanie' });
    expect(d.playerName).toBe('Brave Otter');
  });

  it('a name that fails cleanName is not stored', () => {
    savePlayerName('x');
    expect(loadSave().playerName).toBeUndefined();
  });

  it('demo runs do not change progress, but real ones do and report unlocks', () => {
    const r = fakeResult({ domainId: 'history', outcome: 'qualified', stars: 1, correct: 5 });
    expect(recordRun(r, true)).toEqual([]);
    expect(loadProgress()).toEqual({ stars: 0, correctTotal: 0, weakRuns: 0, achievements: [], owned: [] });
    const unlocked = recordRun(r, false);
    expect(unlocked.map((u) => u.id)).toContain('laurel');
    expect(loadProgress()).toMatchObject({ stars: 1, correctTotal: 5, achievements: ['qualify_history'] });
    // the same run again unlocks nothing new
    expect(recordRun(r, false)).toEqual([]);
  });
});

describe('coin outfits', () => {
  it('banks run coins (not for demo runs) and spends them on a locked outfit once', () => {
    const crown = findItem('hat', 'crown')!;
    expect(isUnlocked(crown, loadProgress())).toBe(false);
    expect(buyItem(crown)).toBe(false); // empty bank
    const r = { ...fakeResult({ domainId: 'math', outcome: 'eliminated', stars: 0, correct: 0 }), coinsCollected: coinPrice(crown) + 3 };
    recordRun(r, true);
    expect(loadCoinBank()).toBe(0);
    recordRun(r, false);
    expect(loadCoinBank()).toBe(coinPrice(crown) + 3);
    expect(buyItem(crown)).toBe(true);
    expect(loadCoinBank()).toBe(3);
    expect(isUnlocked(crown, loadProgress())).toBe(true);
    expect(buyItem(crown)).toBe(false); // already owned, no double charge
    expect(loadCoinBank()).toBe(3);
  });
});

describe('wardrobe booth', () => {
  it('sits at (-6, 9) and opens after standing on it, once, until the player steps off', () => {
    engine.startHub();
    const hub = engine.hub!;
    expect(hub.booths.map((b) => b.id)).toEqual(['wardrobe', 'online']);
    expect(hub.booths[0]).toMatchObject({ id: 'wardrobe', x: -6, z: 9 });
    teleport(G.player, -6, 0, 9);
    advance(0.2);
    expect(useUI.getState().wardrobeOpen).toBe(false);
    advance(0.6);
    expect(useUI.getState().wardrobeOpen).toBe(true);
    // closing while still standing on it does not reopen
    useUI.setState({ wardrobeOpen: false });
    advance(1);
    expect(useUI.getState().wardrobeOpen).toBe(false);
    // stepping off and on again re-arms it
    teleport(G.player, 0, 0, 5);
    advance(0.2);
    teleport(G.player, -6, 0, 9);
    advance(0.8);
    expect(useUI.getState().wardrobeOpen).toBe(true);
    useUI.setState({ wardrobeOpen: false });
    finish();
  });

  it('does not trigger while jumping over it and freezes the hub while the panel is open', () => {
    engine.startHub();
    const hub = engine.hub!;
    expect(stepBooths(hub, -6, 9, false, 5)).toBeNull();
    useUI.setState({ wardrobeOpen: true });
    teleport(G.player, 0, 0, 5);
    const z0 = G.player.pos.z;
    advance(0.5);
    expect(G.player.pos.z).toBe(z0);
    useUI.setState({ wardrobeOpen: false });
    finish();
  });
});
