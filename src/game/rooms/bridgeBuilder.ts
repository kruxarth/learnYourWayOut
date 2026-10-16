import type { OrderQuestion } from '../../content/schema';
import { G, needRun } from '../state';
import { T } from '../tuning';
import type { BlockRT, RoomRuntime } from '../runtime';
import { fadeRespawn, surge } from '../loop/progression';
import { beginRoom, celebrate, pickQuestion, resolveRoom, startRecord, syncRoomPanel } from '../loop/roomCommon';
import { showBanner } from '../../ui/store';

export function activate(room: RoomRuntime): void {
  beginRoom(room);
  const q = pickQuestion(room, 'order', 0) as OrderQuestion;
  room.question = q;
  room.blocks = q.items.map((label, i) => ({
    id: `${room.id}:b${i}`, itemIndex: i, label, state: 'home', home: room.layout.blockHomes[i], t: 0, glow: false, cool: 0,
  }));
  room.nextIndex = 0;
  room.wrongAt = [0, 0, 0, 0];
  room.wrongCount = 0;
  G.player.carrying = null;
}

function carried(room: RoomRuntime): BlockRT | undefined {
  return room.blocks.find((b) => b.id === G.player.carrying);
}

function sendHome(b: BlockRT): void {
  b.state = 'home'; b.t = 0; b.cool = 0.7;
}

export function drop(room: RoomRuntime): void {
  const b = carried(room);
  if (!b) return;
  G.player.carrying = null;
  sendHome(b);
  syncRoomPanel();
}

export function step(room: RoomRuntime, h: number): void {
  const run = needRun();
  // animation runs in every state
  for (const b of room.blocks) {
    if (b.cool > 0) b.cool -= h;
    if (b.state === 'falling') { b.t += h; if (b.t >= 1) sendHome(b); }
  }
  for (let k = 0; k < 4; k++) {
    if (k < room.nextIndex) room.slabAnim[k] = Math.min(1, room.slabAnim[k] + h / 0.4);
  }
  if (room.state !== 'active' || run.phase !== 'playing') return;
  const q = room.question as OrderQuestion | null;
  if (!q) return;
  const p = G.player.pos;

  // pick up
  if (!G.player.carrying) {
    for (const b of room.blocks) {
      if (b.state !== 'home' || b.cool > 0) continue;
      const dx = p.x - b.home.x, dz = p.z - b.home.z;
      if (dx * dx + dz * dz <= T.PICKUP_RADIUS * T.PICKUP_RADIUS) {
        b.state = 'carried'; G.player.carrying = b.id;
        G.events.emit({ type: 'blockPickup' });
        syncRoomPanel();
        break;
      }
    }
  }

  // place at the glowing edge
  const bz = room.layout.buildZone!;
  const b = carried(room);
  if (b && p.x >= bz.minX && p.x <= bz.maxX && p.z >= bz.minZ && p.z <= bz.maxZ) {
    G.player.carrying = null;
    if (b.itemIndex === room.nextIndex) {
      const slab = room.layout.slabs[room.nextIndex];
      run.world.floors[slab.floorId].enabled = true;
      room.slabAnim[room.nextIndex] = 0;
      b.state = 'placed';
      room.nextIndex++;
      room.feedback = { text: `"${b.label}" fits!`, tone: 'good' };
      G.events.emit({ type: 'blockPlaced', correct: true });
      if (room.nextIndex === 4) {
        showBanner('BRIDGE COMPLETE!', 'good', 1400);
        G.events.emit({ type: 'bridgeComplete' });
        const firstTry = room.wrongCount === 0;
        if (firstTry) room.record = startRecord(room, q, true, room.activatedAtMs);
        celebrate(room, { x: p.x, y: 1.2, z: p.z }, firstTry);
        resolveRoom(room, firstTry ? 'correct' : 'remediated');
      }
    } else {
      b.state = 'falling'; b.t = 0;
      room.wrongAt[room.nextIndex]++;
      if (room.wrongCount === 0) {
        room.record = startRecord(room, q, false, room.activatedAtMs);
        surge(1);
      } else {
        if (room.record) room.record.wrongCount++;
        surge(0.5);
      }
      room.wrongCount++;
      const d = run.selection.difficulty;
      if (T.BRIDGE_RESET_ON_WRONG[d] && room.nextIndex > 0) {
        // Hard: the wrong block knocks the whole bridge down; start the order again
        for (let k = 0; k < room.nextIndex; k++) {
          run.world.floors[room.layout.slabs[k].floorId].enabled = false;
          room.slabAnim[k] = 0;
        }
        for (const x of room.blocks) if (x.state === 'placed') sendHome(x);
        room.nextIndex = 0;
        room.feedback = { text: `"${b.label}" is not next. ${q.hint} The bridge fell down!`, tone: 'bad' };
      } else room.feedback = { text: `"${b.label}" is not next. ${q.hint}`, tone: 'bad' };
      if (room.wrongAt[room.nextIndex] >= T.GLOW_AFTER_WRONG[d]) {
        const right = room.blocks.find((x) => x.itemIndex === room.nextIndex);
        if (right) right.glow = true;
      }
      G.events.emit({ type: 'blockPlaced', correct: false });
    }
    syncRoomPanel();
  }
}

/** Falling into the gap: fade and respawn on the start platform; a carried block goes home. */
export function onFall(room: RoomRuntime): boolean {
  const b = carried(room);
  if (b) { G.player.carrying = null; sendHome(b); }
  fadeRespawn(room.layout.startSpawn);
  return true;
}
