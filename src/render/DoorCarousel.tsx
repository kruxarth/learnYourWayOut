import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Color, Group, MeshBasicMaterial, MeshToonMaterial, type Mesh } from 'three';
import type { RoomRuntime, RunState } from '../game/runtime';
import { T } from '../game/tuning';
import { labelTexture } from './labels';
import { PAL, toonGradient } from './materials';
import { withVisibility } from './visibility';

const PANEL_COLORS = { closed: PAL.panel, smashed: '#B8B8C4', wrongX: PAL.bad, burst: PAL.panel, swing: PAL.panel } as const;

/** One sliding panel of the train. Its position follows the WallBox, which the engine moves every step. */
function TrainPanel({ run, room, i }: { run: RunState; room: RoomRuntime; i: number }) {
  const root = useRef<Group>(null);
  const pivot = useRef<Group>(null);
  const body = useRef<Group>(null);
  const label = useRef<Mesh>(null);
  const lastKey = useRef('');
  const c = room.layout.carousel!;
  const panel = room.doorWalls[0].panels[i];
  const wall = run.world.walls[panel.wallId];
  const mats = useMemo(() => ({
    box: withVisibility(new MeshToonMaterial({ color: new Color(PAL.panel), gradientMap: toonGradient(), transparent: true })),
    label: withVisibility(new MeshBasicMaterial({ transparent: true })),
  }), []);
  useEffect(() => () => { mats.box.dispose(); mats.label.dispose(); }, [mats]);

  useFrame(({ clock }) => {
    const r = root.current, pv = pivot.current, b = body.current;
    if (!r || !pv || !b) return;
    const st = panel.state;
    r.visible = !(st === 'burst' && panel.anim >= 1);
    const cx = (wall.minX + wall.maxX) / 2, cz = (wall.minZ + wall.maxZ) / 2;
    r.position.set(cx, 0, cz);
    pv.rotation.set(0, 0, 0);
    b.rotation.set(0, 0, 0);
    mats.box.opacity = 1; mats.label.opacity = 1;
    if (st === 'burst') {
      const a = panel.anim;
      r.position.z = cz - a * 8; r.position.y = a * 4;
      b.rotation.set(a * 5, a * 7, a * 3);
      mats.box.opacity = 1 - a; mats.label.opacity = 1 - a;
    } else if (st === 'swing') {
      pv.rotation.y = -panel.anim * (80 * Math.PI) / 180;
    }
    mats.box.color.set(PANEL_COLORS[st]);
    if (panel.glow && st === 'closed') {
      mats.box.emissive.set(PAL.gold);
      mats.box.emissiveIntensity = 0.45 + 0.35 * Math.sin(clock.elapsedTime * 7);
    } else mats.box.emissiveIntensity = 0;
    const bad = st === 'smashed' || st === 'wrongX';
    const key = `${bad ? 'X' : panel.label}|${st}`;
    if (key !== lastKey.current && label.current) {
      lastKey.current = key;
      mats.label.map = labelTexture({
        text: bad ? 'X' : panel.label, bg: st === 'wrongX' ? '#FFE3E7' : bad ? '#E6E6EE' : '#FFFFFF',
        fg: bad ? PAL.bad : PAL.uiText, border: bad ? PAL.bad : PAL.panelBorder,
      });
      mats.label.needsUpdate = true;
    }
  });

  const w = c.panelW;
  const lw = Math.min(w - 0.4, 4.4);
  return (
    <group ref={root}>
      <group ref={pivot} position={[-w / 2, 0, 0]}>
        <group ref={body} position={[w / 2, 0, 0]}>
          <mesh position={[0, T.PANEL_H / 2, 0]} material={mats.box} castShadow>
            <boxGeometry args={[w, T.PANEL_H, T.PANEL_T]} />
          </mesh>
          <mesh ref={label} position={[0, T.PANEL_H / 2, T.PANEL_T / 2 + 0.012]} material={mats.label}>
            <planeGeometry args={[lw, lw / 2]} />
          </mesh>
        </group>
      </group>
    </group>
  );
}

/** The dark trapdoor in front of the opening while a wrong panel swings open. */
function Trapdoor({ room }: { room: RoomRuntime }) {
  const ref = useRef<Mesh>(null);
  const L = room.layout.doorWalls[0];
  useFrame(() => {
    const m = ref.current;
    if (!m) return;
    const p = room.doorWalls[0].panels.find((x) => x.state === 'swing');
    m.visible = !!p;
    if (p) m.scale.set(1, Math.max(0.05, p.anim), 1);
  });
  return (
    <mesh ref={ref} position={[room.layout.laneX, 0.03, L.z + 1.1]} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
      <planeGeometry args={[T.CAROUSEL_OPEN_HALF * 2, 1.8]} />
      <meshBasicMaterial color="#2B2140" />
    </mesh>
  );
}

export default function DoorCarouselView({ run, room }: { run: RunState; room: RoomRuntime }) {
  return (
    <group>
      {room.doorWalls[0].panels.map((p, i) => <TrainPanel key={p.index} run={run} room={room} i={i} />)}
      <Trapdoor room={room} />
    </group>
  );
}
