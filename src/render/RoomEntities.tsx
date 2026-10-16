import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Color, Group, MeshBasicMaterial, MeshToonMaterial, type Mesh } from 'three';
import type { OrderQuestion } from '../content/schema';
import { engine } from '../game/engine';
import type { BlockRT, RoomRuntime, RunState, TileRT } from '../game/runtime';
import { labelTexture } from './labels';
import { PAL, toonGradient } from './materials';
import { withVisibility } from './visibility';
import LaunchPadsView from './LaunchPads';
import RuleMinefieldView from './RuleMinefield';
import KeyHuntView from './KeyHunt';
import DoorCarouselView from './DoorCarousel';
import MemoryFloorView from './MemoryFloor';
import AnswerLiftsView from './AnswerLifts';
import HexFinaleView from './HexFinale';
import BoulderRunView from './BoulderRun';
import ShiftMazeView from './ShiftMaze';

const TILE_THICK = 0.4;
const GAP = 0.15;

function labelStyle(text: string) {
  if (text === 'TRUE') return { bg: '#D8FFE6', border: PAL.good, fg: '#16794A' };
  if (text === 'FALSE') return { bg: '#FFDDE2', border: PAL.bad, fg: '#B02A3E' };
  if (text === '?') return { bg: '#EEF4FF', border: PAL.tile, fg: '#5A7BA6' };
  return { bg: '#FFFFFF', border: PAL.panelBorder, fg: PAL.uiText };
}

function useTileMaterials() {
  const mats = useMemo(() => ({
    box: withVisibility(new MeshToonMaterial({ color: new Color(PAL.tile), gradientMap: toonGradient(), transparent: true })),
    label: withVisibility(new MeshBasicMaterial({ transparent: true })),
  }), []);
  useEffect(() => () => { mats.box.dispose(); mats.label.dispose(); }, [mats]);
  return mats;
}

/** A floor tile (Tile Drop and Step Stones): label on top, shake / fall / lock states. */
function TileMesh({ get }: { get: () => TileRT | null }) {
  const root = useRef<Group>(null);
  const box = useRef<Mesh>(null);
  const label = useRef<Mesh>(null);
  const lastKey = useRef('');
  const mats = useTileMaterials();

  useFrame(({ clock }) => {
    const r = root.current, b = box.current, l = label.current;
    if (!r || !b || !l) return;
    const t = get();
    if (!t || !t.visible || t.state === 'gone') { r.visible = false; return; }
    r.visible = true;
    let ox = 0, oy = 0, oz = 0, op = 1;
    if (t.state === 'shaking') { ox = (Math.random() - 0.5) * 0.12; oz = (Math.random() - 0.5) * 0.12; }
    else if (t.state === 'falling') { oy = -12 * t.t * t.t; op = Math.max(0, 1 - t.t / 1.2); }
    r.position.set(t.cx + ox, oy, t.cz + oz);
    b.scale.set(Math.max(0.1, t.sx - GAP * 2), TILE_THICK, Math.max(0.1, t.sz - GAP * 2));
    b.position.y = -TILE_THICK / 2;
    mats.box.opacity = op; mats.label.opacity = op;
    if (t.state === 'locked') { mats.box.emissive.set(PAL.good); mats.box.emissiveIntensity = 0.55; }
    else if (t.glow && t.state === 'solid') { mats.box.emissive.set(PAL.gold); mats.box.emissiveIntensity = 0.45 + 0.35 * Math.sin(clock.elapsedTime * 7); }
    else if (t.state === 'shaking') { mats.box.emissive.set(PAL.bad); mats.box.emissiveIntensity = 0.35; }
    else mats.box.emissiveIntensity = 0;
    const text = t.revealed ? t.label : '?';
    const key = `${text}|${Math.round(t.sx * 10)}`;
    if (key !== lastKey.current) {
      lastKey.current = key;
      mats.label.map = labelTexture({ text, ...labelStyle(text) });
      mats.label.needsUpdate = true;
    }
    const lw = Math.max(0.5, Math.min(t.sx - 0.7, (t.sz - 0.7) * 2));
    l.scale.set(lw, lw / 2, 1);
    l.position.y = 0.012;
  });

  return (
    <group ref={root}>
      <mesh ref={box} material={mats.box} receiveShadow castShadow><boxGeometry args={[1, 1, 1]} /></mesh>
      {/* drawn after the slime (renderOrder 3, no depth write) so the labels stay readable when it covers the floor */}
      <mesh ref={label} rotation={[-Math.PI / 2, 0, 0]} material={mats.label} renderOrder={4}><planeGeometry args={[1, 1]} /></mesh>
    </group>
  );
}

function Slab({ room, k }: { room: RoomRuntime; k: number }) {
  const root = useRef<Group>(null);
  const lastKey = useRef('');
  const mats = useTileMaterials();
  const slab = room.layout.slabs[k];
  useFrame(() => {
    const r = root.current;
    if (!r) return;
    const on = room.nextIndex > k;
    r.visible = on;
    if (!on) return;
    const a = room.slabAnim[k];
    r.position.set(slab.cx, -(1 - a) * 1.2, slab.cz);
    mats.box.emissiveIntensity = 0;
    const q = room.question as OrderQuestion | null;
    const text = q ? q.items[k] : '';
    if (text !== lastKey.current) {
      lastKey.current = text;
      mats.label.map = labelTexture({ text, ...labelStyle(text) });
      mats.label.needsUpdate = true;
    }
  });
  return (
    <group ref={root} visible={false}>
      <mesh position={[0, -TILE_THICK / 2, 0]} material={mats.box} castShadow receiveShadow scale={[slab.sx - 0.1, TILE_THICK, slab.sz - 0.1]}>
        <boxGeometry args={[1, 1, 1]} />
      </mesh>
      <mesh position={[0, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]} material={mats.label} renderOrder={4}>
        <planeGeometry args={[slab.sx - 0.7, (slab.sx - 0.7) / 2.2]} />
      </mesh>
    </group>
  );
}

function Block({ room, get, color }: { room: RoomRuntime; get: () => BlockRT | null; color: string }) {
  const root = useRef<Group>(null);
  const label = useRef<Mesh>(null);
  const lastKey = useRef('');
  const camera = useThree((s) => s.camera);
  const mats = useMemo(() => ({
    box: withVisibility(new MeshToonMaterial({ color: new Color(color), gradientMap: toonGradient(), transparent: true })),
    label: withVisibility(new MeshBasicMaterial({ transparent: true, depthTest: false })),
  }), [color]);
  useEffect(() => () => { mats.box.dispose(); mats.label.dispose(); }, [mats]);
  useFrame(({ clock }) => {
    const r = root.current, l = label.current;
    const b = get();
    if (!r || !l) return;
    if (!b || b.state === 'placed') { r.visible = false; return; }
    r.visible = true;
    let op = 1;
    if (b.state === 'carried') {
      const p = engine.player.pos;
      r.position.set(p.x, p.y + 2.1 + Math.sin(clock.elapsedTime * 5) * 0.08, p.z);
      r.rotation.y = clock.elapsedTime * 1.2;
    } else if (b.state === 'falling') {
      const z = room.layout.buildZone!;
      r.position.set((z.minX + z.maxX) / 2, 0.6 - 9 * b.t * b.t, (z.minZ + z.maxZ) / 2);
      op = Math.max(0, 1 - b.t);
    } else {
      r.position.set(b.home.x, 0.6 + Math.sin(clock.elapsedTime * 2 + b.itemIndex) * 0.05, b.home.z);
      r.rotation.y = 0;
    }
    mats.box.opacity = op; mats.label.opacity = op;
    if (b.glow) { mats.box.emissive.set(PAL.gold); mats.box.emissiveIntensity = 0.5 + 0.4 * Math.sin(clock.elapsedTime * 7); }
    else mats.box.emissiveIntensity = 0;
    if (b.label !== lastKey.current) {
      lastKey.current = b.label;
      mats.label.map = labelTexture({ text: b.label, ...labelStyle(b.label) });
      mats.label.needsUpdate = true;
    }
    // billboard the label: copy the camera orientation (inverse of the parent's yaw)
    l.quaternion.copy(camera.quaternion);
    if (r.parent) {
      const q = r.quaternion;
      l.quaternion.premultiply(q.clone().invert());
    }
  });
  return (
    <group ref={root} visible={false}>
      <mesh material={mats.box} castShadow><boxGeometry args={[1.2, 1.2, 1.2]} /></mesh>
      <mesh ref={label} position={[0, 1.3, 0]} material={mats.label} renderOrder={5}>
        <planeGeometry args={[2.6, 1.3]} />
      </mesh>
    </group>
  );
}

function BuildZone({ room }: { room: RoomRuntime }) {
  const ref = useRef<Mesh>(null);
  const bz = room.layout.buildZone!;
  useFrame(({ clock }) => {
    const m = ref.current;
    if (!m) return;
    m.visible = room.state === 'active' && room.nextIndex < 4;
    (m.material as MeshBasicMaterial).opacity = 0.3 + 0.2 * Math.sin(clock.elapsedTime * 5);
  });
  return (
    <mesh ref={ref} position={[(bz.minX + bz.maxX) / 2, 0.03, (bz.minZ + bz.maxZ) / 2]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[bz.maxX - bz.minX, bz.maxZ - bz.minZ]} />
      <meshBasicMaterial color={PAL.gold} transparent opacity={0.4} depthWrite={false} />
    </mesh>
  );
}

export default function RoomEntities({ run }: { run: RunState }) {
  const domainColor = run.pack.color;
  return (
    <>
      {run.rooms.map((room) => {
        if (room.kind === 'doorCarousel') return <DoorCarouselView key={room.id} run={run} room={room} />;
        if (room.kind === 'memoryFloor') {
          return (
            <group key={room.id}>
              {room.tiles.map((_, i) => <TileMesh key={`${room.id}:t${i}`} get={() => room.tiles[i] ?? null} />)}
              <MemoryFloorView run={run} room={room} />
            </group>
          );
        }
        if (room.kind === 'tileDrop') {
          return room.tiles.map((_, i) => <TileMesh key={`${room.id}:t${i}`} get={() => room.tiles[i] ?? null} />);
        }
        if (room.kind === 'stepStones') {
          return room.stepRows.map((row, ri) => row.map((_, si) => (
            <TileMesh key={`${room.id}:s${ri}:${si}`} get={() => room.stepRows[ri][si] ?? null} />
          )));
        }
        if (room.kind === 'bridgeBuilder') {
          return (
            <group key={room.id}>
              <BuildZone room={room} />
              {[0, 1, 2, 3].map((k) => <Slab key={`slab${k}`} room={room} k={k} />)}
              {[0, 1, 2, 3].map((i) => <Block key={`block${i}`} room={room} color={domainColor} get={() => room.blocks[i] ?? null} />)}
            </group>
          );
        }
        if (room.kind === 'launchPads') return <LaunchPadsView key={room.id} run={run} room={room} />;
        if (room.kind === 'ruleMinefield') return <RuleMinefieldView key={room.id} room={room} />;
        if (room.kind === 'keyHunt') return <KeyHuntView key={room.id} room={room} />;
        if (room.kind === 'answerLifts') return <AnswerLiftsView key={room.id} run={run} room={room} />;
        if (room.kind === 'hexFinale' && room.hex) return <HexFinaleView key={room.id} run={run} room={room} />;
        if (room.kind === 'boulderRun') return <BoulderRunView key={room.id} run={run} room={room} />;
        if (room.kind === 'shiftMaze') return <ShiftMazeView key={room.id} run={run} room={room} />;
        return null;
      })}
    </>
  );
}
