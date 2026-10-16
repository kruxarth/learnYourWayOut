import type { AvatarConfig } from '../game/avatar';
import { T } from '../game/tuning';

/**
 * One timestamped sample of a player. Used for the daily ghost and (F3) for network players.
 * `t` is in ms on whatever clock the source uses (run time for a ghost, server-synced time online).
 */
export interface Snapshot {
  t: number;
  x: number; y: number; z: number;
  /** Facing (yaw radians). */
  f: number;
  /** Horizontal speed in m/s. */
  sp: number;
  /** Grounded. */
  g: boolean;
  /** Fake-ragdoll spin progress 0..1 while spinning, absent otherwise. */
  spin?: number;
}

export interface Sampled {
  x: number; y: number; z: number; f: number; sp: number; g: boolean; spin: number;
  /** No newer snapshot for longer than STALE_MS (finished ghost, or a lagging peer). */
  stale: boolean;
}

export function makeSampled(): Sampled {
  return { x: 0, y: 0, z: 0, f: 0, sp: 0, g: true, spin: 0, stale: false };
}

const TAU = Math.PI * 2;

/** Lerp between two angles along the shortest arc. */
export function lerpAngle(a: number, b: number, k: number): number {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  else if (d < -Math.PI) d += TAU;
  return a + d * k;
}

function copy(s: Snapshot, stale: boolean, out: Sampled): Sampled {
  out.x = s.x; out.y = s.y; out.z = s.z; out.f = s.f; out.sp = s.sp; out.g = s.g; out.spin = s.spin ?? 0; out.stale = stale;
  return out;
}

/**
 * The pose at `renderTime` from a time-sorted buffer. Lerps between the two snapshots around that time
 * (shortest arc for facing), snaps instead of lerping across a jump over SNAP_DIST, holds the first/last
 * snapshot outside the buffer, and flags `stale` when the last snapshot is older than STALE_MS.
 * Pure; pass `out` to avoid allocating per frame. Returns null for an empty buffer.
 */
export function sampleSnapshots(buf: readonly Snapshot[], renderTime: number, out: Sampled = makeSampled()): Sampled | null {
  const n = buf.length;
  if (n === 0) return null;
  if (renderTime <= buf[0].t) return copy(buf[0], false, out);
  const last = buf[n - 1];
  if (renderTime >= last.t) return copy(last, renderTime - last.t > T.STALE_MS, out);
  // binary search: buf[lo].t <= renderTime < buf[hi].t
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (buf[mid].t <= renderTime) lo = mid; else hi = mid;
  }
  const a = buf[lo], b = buf[hi];
  const span = b.t - a.t;
  const k = span > 0 ? (renderTime - a.t) / span : 1;
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  if (dx * dx + dy * dy + dz * dz > T.SNAP_DIST * T.SNAP_DIST) return copy(k < 0.5 ? a : b, false, out);
  out.x = a.x + dx * k; out.y = a.y + dy * k; out.z = a.z + dz * k;
  out.f = lerpAngle(a.f, b.f, k);
  out.sp = a.sp + (b.sp - a.sp) * k;
  out.g = k < 0.5 ? a.g : b.g;
  out.spin = (a.spin ?? 0) + ((b.spin ?? 0) - (a.spin ?? 0)) * k;
  out.stale = false;
  return out;
}

/** A source of snapshot buffers that `GhostPlayers` renders (the daily ghost now; F3 network players later). */
export interface SnapshotSource {
  /** Ids of the players to draw. Re-read when `subscribe` fires. */
  ids(): readonly string[];
  buffer(id: string): readonly Snapshot[];
  /** The time to sample at, already delayed if the source wants that (online: now - INTERP_DELAY_MS). */
  renderTime(): number;
  config(id: string): AvatarConfig;
  /** Optional: call back when `ids()` changes. */
  subscribe?(cb: () => void): () => void;
}
