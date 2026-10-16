import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Color, MeshBasicMaterial, MeshToonMaterial, type Group, type Mesh } from 'three';
import type { AlcoveRT, RoomRuntime, RunState } from '../game/runtime';
import { T } from '../game/tuning';
import { labelTexture } from './labels';
import { PAL, toon, toonGradient } from './materials';
import { withVisibility } from './visibility';

const GATE_MAT = toon(PAL.roomWall, {}, 'boulderGate');
const MAX_LABELS = 3;

/** The boulder: a grey rock that rolls with the run clock (its position is engine state). */
function Boulder({ room }: { room: RoomRuntime }) {
  const root = useRef<Group>(null);
  const rock = useRef<Group>(null);
  const L = room.layout.boulder!;
  const mats = useMemo(() => ({
    rock: withVisibility(new MeshToonMaterial({ color: new Color('#8E8A9C'), gradientMap: toonGradient(), transparent: true })),
    patch: withVisibility(new MeshToonMaterial({ color: new Color('#6B6778'), gradientMap: toonGradient(), transparent: true })),
  }), []);
  useEffect(() => () => { mats.rock.dispose(); mats.patch.dispose(); }, [mats]);
  useFrame(({ clock }) => {
    const r = root.current, k = rock.current;
    const B = room.boulder;
    if (!r || !k) return;
    const live = !!B && B.phase !== 'idle' && B.phase !== 'rumble' && B.d > -T.BOULDER_R;
    r.visible = live;
    if (!live || !B) return;
    const smash = B.phase === 'smash' ? Math.min(1, B.t / T.BOULDER_SMASH_S) : 0;
    r.position.set(L.axisX, T.BOULDER_R * (1 - 0.5 * smash), L.z0 - B.d);
    r.scale.setScalar(1 - 0.4 * smash);
    k.rotation.x = -B.d / T.BOULDER_R;
    k.rotation.z = Math.sin(clock.elapsedTime * 40) * 0.01;
    const op = 1 - smash;
    mats.rock.opacity = op; mats.patch.opacity = op;
  });
  return (
    <group ref={root} visible={false}>
      <group ref={rock}>
        <mesh material={mats.rock} castShadow><icosahedronGeometry args={[T.BOULDER_R, 1]} /></mesh>
        <mesh position={[0.5, 0.9, 0.9]} material={mats.patch}><icosahedronGeometry args={[0.55, 0]} /></mesh>
        <mesh position={[-0.8, -0.6, 1.0]} material={mats.patch}><icosahedronGeometry args={[0.45, 0]} /></mesh>
        <mesh position={[0.9, -0.5, -0.9]} material={mats.patch}><icosahedronGeometry args={[0.5, 0]} /></mesh>
        <mesh position={[-0.6, 0.8, -1.0]} material={mats.patch}><icosahedronGeometry args={[0.4, 0]} /></mesh>
      </group>
    </group>
  );
}

/** The answer above an alcove; a wrong one turns red with a cross, the right one green. */
function AlcoveLabel({ room, i }: { room: RoomRuntime; i: number }) {
  const ref = useRef<Mesh>(null);
  const last = useRef('');
  const camera = useThree((s) => s.camera);
  const L = room.layout.boulder!;
  const mat = useMemo(() => withVisibility(new MeshBasicMaterial({ transparent: true, depthTest: false })), []);
  useEffect(() => () => mat.dispose(), [mat]);
  useFrame(({ clock }) => {
    const m = ref.current;
    if (!m) return;
    const B = room.boulder;
    const w = B?.waves[B.wave];
    const al: AlcoveRT | undefined = w?.alcoves[i];
    if (!B || !w || !al || room.state === 'idle') { m.visible = false; return; }
    const geo = L.alcoves[al.slot];
    m.visible = true;
    m.position.set(geo.cx, 2.9 + Math.sin(clock.elapsedTime * 2 + i) * 0.06, geo.cz);
    m.quaternion.copy(camera.quaternion);
    const text = al.state === 'wrong' ? `✗ ${al.label}` : al.label;
    const key = `${text}|${al.state}`;
    if (key !== last.current) {
      last.current = key;
      mat.map = labelTexture(al.state === 'wrong'
        ? { text, w: 640, h: 320, maxLines: 2, bg: '#FFE3E7', fg: PAL.bad, border: PAL.bad }
        : al.state === 'right'
          ? { text, w: 640, h: 320, maxLines: 2, bg: '#D8FFE6', fg: '#16794A', border: PAL.good }
          : { text, w: 640, h: 320, maxLines: 2, bg: '#FFFFFF', fg: PAL.uiText, border: PAL.panelBorder });
      mat.needsUpdate = true;
    }
  });
  return (
    <mesh ref={ref} material={mat} renderOrder={5} visible={false}>
      <planeGeometry args={[2.9, 1.45]} />
    </mesh>
  );
}

/** A gate in an alcove's back wall: it looks like the wall until it slides down. */
function BackGate({ run, id }: { run: RunState; id: number }) {
  const ref = useRef<Mesh>(null);
  const s = useRef(1);
  const w = run.world.walls[id];
  const sx = w.maxX - w.minX, sz = w.maxZ - w.minZ, sy = w.maxY;
  const cx = (w.minX + w.maxX) / 2, cz = (w.minZ + w.maxZ) / 2;
  useFrame((_, dt) => {
    const m = ref.current;
    if (!m) return;
    const target = w.enabled ? 1 : 0;
    s.current += Math.max(-dt * 2.5, Math.min(dt * 2.5, target - s.current));
    m.visible = s.current > 0.02;
    m.scale.set(sx, Math.max(0.01, s.current) * sy, sz);
    m.position.set(cx, (s.current * sy) / 2, cz);
  });
  return <mesh ref={ref} material={GATE_MAT} castShadow><boxGeometry args={[1, 1, 1]} /></mesh>;
}

export default function BoulderRunView({ run, room }: { run: RunState; room: RoomRuntime }) {
  const gates = room.layout.boulder!.alcoves.map((a) => a.gateWallId).filter((g): g is number => g !== null);
  return (
    <group>
      <Boulder room={room} />
      {Array.from({ length: MAX_LABELS }, (_, i) => <AlcoveLabel key={i} room={room} i={i} />)}
      {gates.map((id) => <BackGate key={id} run={run} id={id} />)}
    </group>
  );
}
