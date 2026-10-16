import { questionSource } from '../../content/source';
import { mulberry32 } from '../rng';
import { T } from '../tuning';
import type { DomainId, Difficulty, FloorRect } from '../types';
import { makeWorld, type World } from '../world';

export interface HubPad { domainId: DomainId; difficulty: Difficulty; x: number; z: number; color: string }
export interface HubPortal { domainId: DomainId; name: string; x: number; z: number; color: string; angle: number }

/** A utility booth on the hub floor (F1 Wardrobe; F3 will add Play Online at (6, 9)). Standing on it opens a panel. */
export interface HubBooth { id: 'wardrobe' | 'online'; x: number; z: number; color: string; label: string }

export interface HubState {
  world: World;
  portals: HubPortal[];
  pads: HubPad[];
  booths: HubBooth[];
  /** Booth the player is standing on and how long; `boothLatch` stops it re-opening until they step off. */
  boothHold: number;
  boothActive: HubBooth | null;
  boothLatch: HubBooth | null;
  trees: { x: number; z: number; s: number }[];
  hold: number;
  activePad: HubPad | null;
  starting: boolean;
  /** A pad that opened a panel (Any Topic). It cannot fire again until the player steps off it. */
  lockedPad: HubPad | null;
}

const PORTAL_PHI: Record<DomainId, number> = { math: -60, science: -30, custom: 0, history: 30, programming: 60 };
const PORTAL_COLOR: Record<DomainId, string> = { math: '#4F8BFF', science: '#3DDC84', history: '#FF9F43', programming: '#B05CFF', custom: '#FF7EB6' };
const PAD_RADIUS: Record<Difficulty, number> = { easy: 7.5, normal: 10, hard: 12.5 };
export const PAD_COLOR: Record<Difficulty, string> = { easy: '#3DDC84', normal: '#FFC93C', hard: '#FF5A6E' };

export function buildHub(): HubState {
  const floor: FloorRect = { id: 0, minX: -23, maxX: 23, minZ: -23, maxZ: 23, top: 0, enabled: true, isStatic: true, color: '#FFF1D6' };
  const world = makeWorld([], [floor], T.HUB_RADIUS);
  const portals: HubPortal[] = [];
  const pads: HubPad[] = [];
  // Any Topic sits at the centre (φ = 0°); its pads open the Topic panel on that difficulty instead of starting a run
  const domains = [...questionSource.listDomains(), { id: 'custom' as DomainId, name: 'Any Topic', color: PORTAL_COLOR.custom }];
  for (const d of domains) {
    const phi = (PORTAL_PHI[d.id] * Math.PI) / 180;
    portals.push({ domainId: d.id, name: d.name, x: 16 * Math.sin(phi), z: -16 * Math.cos(phi), color: PORTAL_COLOR[d.id], angle: phi });
    for (const diff of ['easy', 'normal', 'hard'] as Difficulty[]) {
      const r = PAD_RADIUS[diff];
      pads.push({ domainId: d.id, difficulty: diff, x: r * Math.sin(phi), z: -r * Math.cos(phi), color: PAD_COLOR[diff] });
    }
  }
  const rng = mulberry32(7);
  const trees: HubState['trees'] = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + rng() * 0.3;
    const r = 19.6 + rng() * 1.2;
    trees.push({ x: r * Math.sin(a), z: -r * Math.cos(a), s: 0.9 + rng() * 0.5 });
  }
  const booths: HubBooth[] = [{ id: 'wardrobe', x: -6, z: 9, color: '#B05CFF', label: 'WARDROBE' },
    // F3: Play Online, south-east of the spawn
    { id: 'online', x: 6, z: 9, color: '#3DA9FF', label: 'Play Online' }];
  return { world, portals, pads, booths, boothHold: 0, boothActive: null, boothLatch: null, trees, hold: 0, activePad: null, starting: false, lockedPad: null };
}

export function padUnderPlayer(hub: HubState, px: number, pz: number): HubPad | null {
  for (const pad of hub.pads) {
    const dx = px - pad.x, dz = pz - pad.z;
    if (dx * dx + dz * dz < T.PAD_RADIUS * T.PAD_RADIUS) return pad;
  }
  return null;
}

/** Charge the pad under the player. Returns the pad to start once the hold time is reached. */
export function stepHub(hub: HubState, px: number, pz: number, grounded: boolean, h: number): HubPad | null {
  if (hub.starting) return null;
  const pad = grounded ? padUnderPlayer(hub, px, pz) : null;
  if (hub.lockedPad && pad !== hub.lockedPad) hub.lockedPad = null;
  if (pad && pad === hub.lockedPad) { hub.activePad = null; hub.hold = 0; return null; }
  if (pad !== hub.activePad) { hub.activePad = pad; hub.hold = 0; }
  if (!pad) return null;
  hub.hold += h;
  if (hub.hold >= T.PAD_HOLD_TIME) { hub.starting = true; return pad; }
  return null;
}

export function boothUnderPlayer(hub: HubState, px: number, pz: number): HubBooth | null {
  for (const b of hub.booths) {
    const dx = px - b.x, dz = pz - b.z;
    if (dx * dx + dz * dz < T.PAD_RADIUS * T.PAD_RADIUS) return b;
  }
  return null;
}

/** Returns a booth to open once the player has stood on it for BOOTH_HOLD_TIME. It re-arms after they step off. */
export function stepBooths(hub: HubState, px: number, pz: number, grounded: boolean, h: number): HubBooth | null {
  const b = grounded ? boothUnderPlayer(hub, px, pz) : null;
  if (b !== hub.boothActive) { hub.boothActive = b; hub.boothHold = 0; }
  if (!b) { hub.boothLatch = null; return null; }
  if (hub.boothLatch === b) return null;
  hub.boothHold += h;
  if (hub.boothHold >= T.BOOTH_HOLD_TIME) { hub.boothLatch = b; return b; }
  return null;
}
