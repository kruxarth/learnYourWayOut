import { useEffect, useRef, useState } from 'react';
import { engine } from '../game/engine';
import type { RunState } from '../game/runtime';
import { BODY_COLORS } from '../game/palette';
import { T } from '../game/tuning';
import { remotes, useNet } from '../net/store';
import { ROOM_INFO } from './roomInfo';
import type { FloorRect } from '../game/types';

const PX = 360;           // internal canvas size (CSS shows 180)
const WINDOW_M = 64;      // meters shown
const SCALE = PX / WINDOW_M;
const CELL = 2;           // reveal grid cell (m)

/** `cells`: revealed (1) or not; `floor`: the cell centre is over a floor, so explored ground can be shaded. */
interface Grid { minX: number; minZ: number; w: number; h: number; cells: Uint8Array; floor: Uint8Array }

function makeGrid(minX: number, maxX: number, minZ: number, maxZ: number, floors: FloorRect[]): Grid {
  const w = Math.ceil((maxX - minX) / CELL) + 1, h = Math.ceil((maxZ - minZ) / CELL) + 1;
  const floor = new Uint8Array(w * h);
  for (const f of floors) {
    const ix0 = Math.max(0, Math.ceil((f.minX - minX) / CELL - 0.5)), ix1 = Math.min(w - 1, Math.floor((f.maxX - minX) / CELL - 0.5));
    const iz0 = Math.max(0, Math.ceil((f.minZ - minZ) / CELL - 0.5)), iz1 = Math.min(h - 1, Math.floor((f.maxZ - minZ) / CELL - 0.5));
    for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) floor[iz * w + ix] = 1;
  }
  return { minX, minZ, w, h, cells: new Uint8Array(w * h), floor };
}
function isRevealed(g: Grid, x: number, z: number): boolean {
  const ix = Math.floor((x - g.minX) / CELL), iz = Math.floor((z - g.minZ) / CELL);
  return ix >= 0 && iz >= 0 && ix < g.w && iz < g.h && g.cells[iz * g.w + ix] === 1;
}
function reveal(g: Grid, px: number, pz: number, R: number): void {
  const r = Math.ceil(R / CELL);
  const cx = Math.floor((px - g.minX) / CELL), cz = Math.floor((pz - g.minZ) / CELL);
  for (let dx = -r; dx <= r; dx++) {
    for (let dz = -r; dz <= r; dz++) {
      const ix = cx + dx, iz = cz + dz;
      if (ix < 0 || iz < 0 || ix >= g.w || iz >= g.h) continue;
      const wx = g.minX + (ix + 0.5) * CELL, wz = g.minZ + (iz + 0.5) * CELL;
      if ((wx - px) ** 2 + (wz - pz) ** 2 <= R * R) g.cells[iz * g.w + ix] = 1;
    }
  }
}


/** Draws the map; returns false when there is no map here (Hard, inside a crossroads maze). */
function draw(ctx: CanvasRenderingContext2D, run: RunState, main: Grid, det: Grid): boolean {
  const p = engine.player.pos;
  const inDetour = p.x > 300;
  const g = inDetour ? det : main;
  const d = run.selection.difficulty;
  // Hard: no map inside a crossroads maze (the component shows a small chip instead)
  const seg = run.course.segments[run.segIndex];
  if (!inDetour && T.MINIMAP_OFF_IN_QUIZ[d] && seg?.kind === 'quizMaze') return false;
  ctx.clearRect(0, 0, PX, PX);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.beginPath(); ctx.roundRect(0, 0, PX, PX, 28); ctx.fill();
  reveal(g, p.x, p.z, T.MINIMAP_REVEAL[d]);
  ctx.save();
  ctx.beginPath(); ctx.roundRect(0, 0, PX, PX, 28); ctx.clip();
  const sx = (x: number) => (x - p.x) * SCALE + PX / 2;
  const sz = (z: number) => (z - p.z) * SCALE + PX / 2;
  const half = WINDOW_M / 2 + 2;

  // explored ground: revealed cells over a floor, so the shape of where you've been reads, not just loose wall lines
  ctx.fillStyle = '#FFE2B0';
  const ix0 = Math.max(0, Math.floor((p.x - half - g.minX) / CELL)), ix1 = Math.min(g.w - 1, Math.floor((p.x + half - g.minX) / CELL));
  const iz0 = Math.max(0, Math.floor((p.z - half - g.minZ) / CELL)), iz1 = Math.min(g.h - 1, Math.floor((p.z + half - g.minZ) / CELL));
  for (let iz = iz0; iz <= iz1; iz++) {
    for (let ix = ix0; ix <= ix1; ix++) {
      const k = iz * g.w + ix;
      if (g.cells[k] && g.floor[k]) ctx.fillRect(sx(g.minX + ix * CELL), sz(g.minZ + iz * CELL), CELL * SCALE + 0.5, CELL * SCALE + 0.5);
    }
  }

  for (const w of run.world.walls) {
    if (!w.enabled && w.kind !== 'gate') continue;
    if (inDetour !== w.minX > 300) continue;
    if (w.maxX < p.x - half || w.minX > p.x + half || w.maxZ < p.z - half || w.minZ > p.z + half) continue;
    // revealed if any sample along the long axis is in a revealed cell
    const long = w.maxX - w.minX >= w.maxZ - w.minZ;
    const n = Math.max(1, Math.ceil((long ? w.maxX - w.minX : w.maxZ - w.minZ) / CELL));
    let seen = false;
    for (let i = 0; i <= n && !seen; i++) {
      const t = i / n;
      const x = long ? w.minX + (w.maxX - w.minX) * t : (w.minX + w.maxX) / 2;
      const z = long ? (w.minZ + w.maxZ) / 2 : w.minZ + (w.maxZ - w.minZ) * t;
      seen = isRevealed(g, x, z);
    }
    if (!seen) continue;
    if (w.kind === 'panel') ctx.fillStyle = '#FFC93C';
    else if (w.kind === 'detourHedge') ctx.fillStyle = '#7A5CE0';
    else if (w.kind === 'gate') ctx.fillStyle = '#FF7AB6';
    else if (w.kind === 'room' || w.kind === 'doorWall') ctx.fillStyle = '#6B4FC8';
    else ctx.fillStyle = '#2F7D46';
    ctx.fillRect(sx(w.minX), sz(w.minZ), Math.max(4, (w.maxX - w.minX) * SCALE), Math.max(4, (w.maxZ - w.minZ) * SCALE));
  }

  if (!inDetour) {
    ctx.font = '800 22px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const room of run.rooms) {
      const lx = room.layout.laneX, lz = room.layout.z0 - Math.min(room.layout.depth, 14) / 2;
      if (!isRevealed(g, lx, lz) && !isRevealed(g, lx, room.layout.z0 - 2)) continue;
      const x = sx(lx), y = sz(lz);
      ctx.fillStyle = room.state === 'resolved' ? '#9fdcb4' : '#FF4FA0';
      ctx.beginPath(); ctx.arc(x, y, 17, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.fillText(ROOM_INFO[room.kind].letter, x, y + 1);
    }
    ctx.fillStyle = '#FFD23F';
    for (const c of run.course.coins) {
      if (c.taken || !isRevealed(g, c.x, c.z)) continue;
      ctx.beginPath(); ctx.arc(sx(c.x), sz(c.z), 6, 0, Math.PI * 2); ctx.fill();
    }
    // Key Hunt: a key shows once its dead end has been seen (a crossed-out key is a red X)
    ctx.font = '800 26px sans-serif';
    for (const room of run.rooms) {
      if (room.kind !== 'keyHunt') continue;
      for (const k of room.keys) {
        if (k.state === 'used' || k.state === 'carried' || !isRevealed(g, k.home.x, k.home.z)) continue;
        ctx.fillStyle = k.state === 'wrong' ? '#FF4F6A' : '#E8A800';
        ctx.fillText(k.state === 'wrong' ? '✗' : '🗝', sx(k.home.x), sz(k.home.z));
      }
    }
    const e = run.course.exitPortal;
    ctx.fillStyle = '#FF4FA0'; ctx.font = '800 30px sans-serif';
    ctx.fillText('★', sx(e.x), sz(e.z));
  }

  // online: one coloured dot per other player (on the same side, main course or detour, as me)
  if (run.selection.mode === 'online') {
    const fin = useNet.getState().finishes;
    for (const r of remotes.values()) {
      const s = r.buf[r.buf.length - 1];
      if (!s || fin[r.id] || r.connected === false || (s.x > 300) !== inDetour) continue;
      const x = sx(s.x), y = sz(s.z);
      if (x < -8 || y < -8 || x > PX + 8 || y > PX + 8) continue;
      ctx.fillStyle = BODY_COLORS[r.avatar.body]; ctx.strokeStyle = '#2B2D42'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
  }

  // player triangle pointing along facing (model faces local −Z, so forward = (−sin f, −cos f))
  const f = engine.player.facing;
  ctx.save();
  ctx.translate(PX / 2, PX / 2);
  ctx.rotate(-f);
  ctx.fillStyle = '#FF7AB6'; ctx.strokeStyle = '#2B2D42'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(0, -13); ctx.lineTo(10, 11); ctx.lineTo(-10, 11); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore();
  ctx.restore();
  return true;
}

export default function Minimap() {
  const ref = useRef<HTMLCanvasElement>(null);
  const [off, setOff] = useState(false);
  useEffect(() => {
    const run = engine.run;
    const canvas = ref.current;
    if (!run || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const b = run.course.bounds, d = run.course.detour.bounds;
    const main = makeGrid(b.minX - 4, b.maxX + 4, b.minZ - 4, b.maxZ + 4, run.course.floors.filter((f) => f.minX <= 300));
    const det = makeGrid(d.minX - 2, d.maxX + 2, d.minZ - 2, d.maxZ + 2, run.course.floors.filter((f) => f.minX > 300));
    const tick = () => setOff(!draw(ctx, run, main, det));
    const id = setInterval(tick, 100);
    tick();
    return () => clearInterval(id);
  }, []);
  // the canvas stays mounted (it holds the reveal), hidden while there is no map
  return (
    <>
      <div className="minimap card" aria-hidden="true" style={off ? { display: 'none' } : undefined}>
        <canvas ref={ref} width={PX} height={PX} />
      </div>
      {off && <div className="minimap-off stat-chip">🧭 No map in the Crossroads</div>}
    </>
  );
}
