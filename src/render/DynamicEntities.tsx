import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  Color, DoubleSide, Group, MeshBasicMaterial, MeshToonMaterial, type Mesh,
} from 'three';
import { engine } from '../game/engine';
import type { Panel, RunState } from '../game/runtime';
import { T } from '../game/tuning';
import type { WallBox } from '../game/types';
import { labelTexture, signTexture } from './labels';
import { PAL, toon, toonGradient } from './materials';
import Hazards from './Hazards';
import RoomEntities from './RoomEntities';
import { withVisibility } from './visibility';
import DetourBoards, { ScenicBoards } from './DetourBoards';
import QuizSigns from './QuizSigns';

const GATE_MAT = toon(PAL.gate, { transparent: true, opacity: 0.6, depthWrite: false }, 'gate');

function Gate({ wall }: { wall: WallBox }) {
  const ref = useRef<Mesh>(null);
  const s = useRef(wall.enabled ? 1 : 0);
  const w = wall.maxX - wall.minX, d = wall.maxZ - wall.minZ, hgt = wall.maxY;
  const cx = (wall.minX + wall.maxX) / 2, cz = (wall.minZ + wall.maxZ) / 2;
  useFrame((_, dt) => {
    const m = ref.current;
    if (!m) return;
    const target = wall.enabled ? 1 : 0;
    const step = Math.min(dt, 0.1) / 0.3;
    s.current += Math.max(-step, Math.min(step, target - s.current));
    m.visible = s.current > 0.01;
    m.scale.set(w, Math.max(0.001, s.current) * hgt, d);
    m.position.set(cx, (s.current * hgt) / 2, cz);
  });
  return <mesh ref={ref} material={GATE_MAT}><boxGeometry args={[1, 1, 1]} /></mesh>;
}

// ───────────────────────── door panels ─────────────────────────

const PANEL_COLORS = { closed: PAL.panel, smashed: '#B8B8C4', wrongX: PAL.bad, burst: PAL.panel, swing: PAL.panel } as const;

export function DoorPanel({ wall, getPanel }: { wall: WallBox; getPanel: () => Panel | null }) {
  const root = useRef<Group>(null);
  const pivot = useRef<Group>(null);
  const body = useRef<Group>(null);
  const label = useRef<Mesh>(null);
  const lastKey = useRef('');
  const cx = (wall.minX + wall.maxX) / 2, cz = (wall.minZ + wall.maxZ) / 2;
  const mats = useMemo(() => ({
    box: withVisibility(new MeshToonMaterial({ color: new Color(PAL.panel), gradientMap: toonGradient(), transparent: true })),
    label: withVisibility(new MeshBasicMaterial({ transparent: true })),
  }), []);
  useEffect(() => () => { mats.box.dispose(); mats.label.dispose(); }, [mats]);

  useFrame(({ clock }) => {
    const r = root.current, pv = pivot.current, b = body.current;
    if (!r || !pv || !b) return;
    const p = getPanel();
    if (!p) { r.visible = false; return; }
    const st = p.state;
    r.visible = !(st === 'burst' && p.anim >= 1);
    r.position.set(cx, 0, cz);
    pv.rotation.set(0, 0, 0);
    b.rotation.set(0, 0, 0);
    mats.box.opacity = 1; mats.label.opacity = 1;
    if (st === 'burst') {
      const a = p.anim;
      r.position.z = cz - a * 8;
      r.position.y = a * 4;
      b.rotation.set(a * 5, a * 7, a * 3);
      mats.box.opacity = 1 - a; mats.label.opacity = 1 - a;
    } else if (st === 'swing') {
      pv.rotation.y = -p.anim * (80 * Math.PI) / 180;
    } else if (st === 'smashed' || st === 'wrongX') {
      mats.box.opacity = 1;
    }
    mats.box.color.set(p.gold && st === 'closed' ? '#FFD23F' : PANEL_COLORS[st]);
    if ((p.glow || p.gold) && st === 'closed') {
      mats.box.emissive.set(PAL.gold);
      mats.box.emissiveIntensity = 0.45 + 0.35 * Math.sin(clock.elapsedTime * 7);
    } else mats.box.emissiveIntensity = 0;
    const key = `${st === 'smashed' || st === 'wrongX' ? 'X' : p.label}|${st}`;
    if (key !== lastKey.current && label.current) {
      lastKey.current = key;
      const bad = st === 'smashed' || st === 'wrongX';
      mats.label.map = labelTexture({
        text: bad ? 'X' : p.label, bg: st === 'wrongX' ? '#FFE3E7' : bad ? '#E6E6EE' : p.gold ? '#FFF3B0' : '#FFFFFF',
        fg: bad ? PAL.bad : p.gold ? '#C77800' : PAL.uiText, border: bad ? PAL.bad : p.gold ? '#FFB800' : PAL.panelBorder,
      });
      mats.label.needsUpdate = true;
    }
  });

  return (
    <group ref={root}>
      <group ref={pivot} position={[-T.PANEL_W / 2, 0, 0]}>
        <group ref={body} position={[T.PANEL_W / 2, 0, 0]}>
          <mesh position={[0, T.PANEL_H / 2, 0]} material={mats.box} castShadow>
            <boxGeometry args={[T.PANEL_W, T.PANEL_H, T.PANEL_T]} />
          </mesh>
          <mesh ref={label} position={[0, T.PANEL_H / 2, T.PANEL_T / 2 + 0.012]} material={mats.label}>
            <planeGeometry args={[T.PANEL_W - 0.3, (T.PANEL_W - 0.3) / 2]} />
          </mesh>
        </group>
      </group>
    </group>
  );
}

function Trapdoor({ x, z, getPanel }: { x: number; z: number; getPanel: () => Panel | null }) {
  const ref = useRef<Mesh>(null);
  useFrame(() => {
    const m = ref.current;
    if (!m) return;
    const p = getPanel();
    const on = !!p && p.state === 'swing';
    m.visible = on;
    if (on) m.scale.set(1, Math.max(0.05, p!.anim), 1);
  });
  return (
    <mesh ref={ref} position={[x, 0.03, z]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[T.PANEL_W, 1.8]} />
      <meshBasicMaterial color="#2B2140" />
    </mesh>
  );
}

function DoorWalls({ run }: { run: RunState }) {
  return (
    <>
      {run.rooms.map((room) => room.kind === 'doorCarousel' ? null : room.doorWalls.map((dw, wi) => {
        const layout = room.layout.doorWalls[wi];
        return dw.panels.map((p, pi) => (
          <group key={`${room.id}:${wi}:${pi}`}>
            <DoorPanel wall={run.world.walls[p.wallId]} getPanel={() => p} />
            {room.kind === 'doorRush' && (
              <Trapdoor x={layout.doors[pi].cx} z={layout.z - 1.1} getPanel={() => p} />
            )}
          </group>
        ));
      }))}
      {run.rooms.map((room) => room.gold && (
        <DoorPanel key={`gold:${room.id}`} wall={run.world.walls[room.gold.wallId]} getPanel={() => room.gold} />
      ))}
      {run.course.detour.retryWall.doors.map((d, i) => (
        <DoorPanel key={`detour:${i}`} wall={run.world.walls[d.wallId]} getPanel={() => engine.run?.detour?.retryWall.panels[i] ?? null} />
      ))}
    </>
  );
}

// ───────────────────────── coins, pads, signs, arches, portals ─────────────────────────

const COIN_MAT = toon(PAL.gold, { emissive: new Color(PAL.gold), emissiveIntensity: 0.35 }, 'coin');

function Coins({ run }: { run: RunState }) {
  const refs = useRef<(Group | null)[]>([]);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    run.course.coins.forEach((c, i) => {
      const g = refs.current[i];
      if (!g) return;
      g.visible = !c.taken;
      g.position.set(c.x, c.y + Math.sin(t * 2 + i) * 0.08, c.z);
      g.rotation.y = t * 3;
    });
  });
  return (
    <>
      {run.course.coins.map((c, i) => (
        <group key={c.id} ref={(el) => { refs.current[i] = el; }} position={[c.x, c.y, c.z]}>
          <mesh rotation={[Math.PI / 2, 0, 0]} material={COIN_MAT} castShadow>
            <cylinderGeometry args={[0.35, 0.35, 0.08, 20]} />
          </mesh>
        </group>
      ))}
    </>
  );
}

function SpeedPads({ run }: { run: RunState }) {
  const tex = useMemo(() => labelTexture({ text: '▲', bg: '#7DF9FF', fg: '#FFFFFF', border: '#FFFFFF', w: 256, h: 256 }), []);
  return (
    <>
      {run.course.speedPads.map((p, i) => (
        <mesh key={i} position={[p.x, 0.03, p.z]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[3, 3]} />
          <meshBasicMaterial map={tex} />
        </mesh>
      ))}
    </>
  );
}

function Pillar({ x, h }: { x: number; h: number }) {
  return (
    <mesh position={[x, h / 2, 0]} material={toon('#FFFFFF', {}, 'white')} castShadow>
      <cylinderGeometry args={[0.28, 0.32, h, 12]} />
    </mesh>
  );
}

function Signs({ run }: { run: RunState }) {
  const items = useMemo(() => run.course.signs.map((s) => ({ s, tex: signTexture(s.title, s.subtitle) })), [run]);
  return (
    <>
      {items.map(({ s, tex }, i) => (
        <group key={i} position={[s.x, 0, s.z]}>
          <Pillar x={-3.2} h={s.y + 1.5} />
          <Pillar x={3.2} h={s.y + 1.5} />
          <mesh position={[0, s.y, 0]} material={toon(PAL.doorWall, {}, 'sign')} castShadow>
            <boxGeometry args={[7, 3.4, 0.3]} />
          </mesh>
          <mesh position={[0, s.y, 0.16]}>
            <planeGeometry args={[6.6, 3.0]} />
            <meshBasicMaterial map={tex} />
          </mesh>
        </group>
      ))}
    </>
  );
}

function Arches({ run }: { run: RunState }) {
  const items = useMemo(() => run.course.arches.map((a) => ({
    a, tex: labelTexture({ text: a.text, w: 1024, h: 256, maxLines: 1, bg: '#FFF7FB', border: PAL.uiAccent }),
  })), [run]);
  return (
    <>
      {items.map(({ a, tex }, i) => (
        <group key={i} position={[a.x, 0, a.z]}>
          <Pillar x={-4.4} h={4.6} />
          <Pillar x={4.4} h={4.6} />
          <mesh position={[0, 4.6, 0]} material={toon(PAL.uiAccent, {}, 'arch')} castShadow>
            <boxGeometry args={[9.6, 1.7, 0.4]} />
          </mesh>
          <mesh position={[0, 4.6, 0.22]}>
            <planeGeometry args={[9.2, 1.4]} />
            <meshBasicMaterial map={tex} />
          </mesh>
        </group>
      ))}
    </>
  );
}

function Portal({ x, y, z, radius, color, inner }: { x: number; y: number; z: number; radius: number; color: string; inner: string }) {
  const disc = useRef<Mesh>(null);
  const root = useRef<Group>(null);
  useFrame(({ clock }) => {
    if (disc.current) disc.current.rotation.z = clock.elapsedTime * 1.5;
    if (root.current) root.current.position.y = y + Math.sin(clock.elapsedTime * 1.6) * 0.1;
  });
  const mat = useMemo(() => new MeshBasicMaterial({ color: new Color(inner), transparent: true, opacity: 0.55, side: DoubleSide }), [inner]);
  return (
    <group ref={root} position={[x, y, z]}>
      <mesh material={toon(color, { emissive: new Color(color), emissiveIntensity: 0.4 }, `portal${color}`)}>
        <torusGeometry args={[radius, radius * 0.16, 14, 36]} />
      </mesh>
      <mesh ref={disc} material={mat}>
        <circleGeometry args={[radius * 0.9, 24, 0, Math.PI * 1.7]} />
      </mesh>
    </group>
  );
}

export default function DynamicEntities({ run }: { run: RunState }) {
  const gates = useMemo(() => run.world.walls.filter((w) => w.kind === 'gate'), [run]);
  const camera = useThree((s) => s.camera);
  void camera;
  return (
    <>
      {gates.map((w) => <Gate key={w.id} wall={w} />)}
      <DoorWalls run={run} />
      <Coins run={run} />
      <SpeedPads run={run} />
      <Signs run={run} />
      <Arches run={run} />
      <Portal x={run.course.exitPortal.x} y={run.course.exitPortal.y} z={run.course.exitPortal.z} radius={2} color="#FF7AB6" inner="#FFE9A8" />
      <Portal x={run.course.detour.portal.x} y={run.course.detour.portal.y} z={run.course.detour.portal.z} radius={1.4} color="#9B7BFF" inner="#E6D9FF" />
      <Hazards run={run} />
      <RoomEntities run={run} />
      <QuizSigns run={run} />
      <DetourBoards run={run} />
      <ScenicBoards run={run} />
    </>
  );
}
