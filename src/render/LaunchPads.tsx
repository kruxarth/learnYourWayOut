import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Color, DoubleSide, Group, MeshBasicMaterial, MeshToonMaterial, type Mesh } from 'three';
import type { RoomRuntime, RunState } from '../game/runtime';
import { labelTexture } from './labels';
import { PAL, toon, toonGradient } from './materials';
import { withVisibility } from './visibility';

const MAX_PADS = 4;
const PAD_R = 1.2;

const HEDGE_MAT = toon(PAL.hedge, {}, 'launchHedge');
const HEDGE_TOP_MAT = toon(PAL.hedgeTop, {}, 'launchHedgeTop');
const RING_MAT = new MeshBasicMaterial({ color: '#FFFFFF', transparent: true, opacity: 0.8, side: DoubleSide });

/** The tall hedge with no door (a dynamic wall, so it is drawn here). */
function Hedge({ run, room }: { run: RunState; room: RoomRuntime }) {
  const L = room.layout.launch!;
  const w = run.world.walls[L.hedgeWallId];
  const sx = w.maxX - w.minX, sz = w.maxZ - w.minZ, sy = w.maxY;
  const cx = (w.minX + w.maxX) / 2, cz = (w.minZ + w.maxZ) / 2;
  return (
    <group>
      <mesh position={[cx, sy / 2, cz]} scale={[sx, sy, sz]} material={HEDGE_MAT} castShadow receiveShadow><boxGeometry args={[1, 1, 1]} /></mesh>
      <mesh position={[cx, sy - 0.05, cz]} scale={[sx + 0.04, 0.12, sz + 0.04]} material={HEDGE_TOP_MAT}><boxGeometry args={[1, 1, 1]} /></mesh>
    </group>
  );
}

/** The question, floating above the hedge. */
function QuestionBoard({ run, room }: { run: RunState; room: RoomRuntime }) {
  const L = room.layout.launch!;
  const mat = useMemo(() => withVisibility(new MeshBasicMaterial({ transparent: true })), []);
  const ref = useRef<Mesh>(null);
  const last = useRef('');
  useEffect(() => () => mat.dispose(), [mat]);
  useFrame(() => {
    const m = ref.current;
    if (!m) return;
    const q = room.question;
    const show = !!q && room.state !== 'idle';
    m.visible = show && run.phase !== 'won';
    if (!show || !q) return;
    if (q.id !== last.current) {
      last.current = q.id;
      mat.map = labelTexture({ text: q.prompt, w: 1024, h: 320, maxLines: 3, border: PAL.uiAccent, bg: '#FFFFFF' });
      mat.needsUpdate = true;
    }
  });
  return (
    <mesh ref={ref} position={[room.layout.laneX, L.hedgeH + 2, L.hedgeZ + 0.5]} material={mat} visible={false}>
      <planeGeometry args={[11, 3.4]} />
    </mesh>
  );
}

/** One pad: a disc, a ring that fills while the bean stands on it, and a floating answer label. */
function Pad({ room, i }: { room: RoomRuntime; i: number }) {
  const root = useRef<Group>(null);
  const fill = useRef<Mesh>(null);
  const label = useRef<Mesh>(null);
  const lastKey = useRef('');
  const camera = useThree((s) => s.camera);
  const mats = useMemo(() => ({
    disc: withVisibility(new MeshToonMaterial({ color: new Color('#7DF9FF'), gradientMap: toonGradient(), transparent: true })),
    fill: new MeshBasicMaterial({ color: PAL.gold, transparent: true, opacity: 0.85, depthWrite: false }),
    label: withVisibility(new MeshBasicMaterial({ transparent: true, depthTest: false })),
  }), []);
  useEffect(() => () => { mats.disc.dispose(); mats.fill.dispose(); mats.label.dispose(); }, [mats]);

  useFrame(({ clock }) => {
    const r = root.current, f = fill.current, l = label.current;
    if (!r || !f || !l) return;
    const pad = room.pads[i];
    if (!pad || room.state === 'idle') { r.visible = false; return; }
    r.visible = true;
    r.position.set(pad.x, 0, pad.z);
    const bad = pad.state === 'wrong';
    mats.disc.color.set(bad ? PAL.bad : '#7DF9FF');
    mats.disc.emissive.set(bad ? PAL.bad : PAL.gold);
    mats.disc.emissiveIntensity = bad ? 0.25 : pad.charge * 0.6;
    f.visible = pad.charge > 0.01;
    f.scale.setScalar(Math.max(0.01, pad.charge) * (PAD_R - 0.1));
    const text = bad ? `X ${pad.label}` : pad.label;
    if (text !== lastKey.current) {
      lastKey.current = text;
      mats.label.map = labelTexture({
        text, w: 640, h: 320, maxLines: 2,
        bg: bad ? '#FFE3E7' : '#FFFFFF', fg: bad ? PAL.bad : PAL.uiText, border: bad ? PAL.bad : PAL.panelBorder,
      });
      mats.label.needsUpdate = true;
    }
    l.position.y = 2.7 + Math.sin(clock.elapsedTime * 2 + i) * 0.06;
    l.quaternion.copy(camera.quaternion);
  });

  return (
    <group ref={root} visible={false}>
      <mesh position={[0, 0.07, 0]} material={mats.disc} receiveShadow><cylinderGeometry args={[PAD_R, PAD_R, 0.14, 28]} /></mesh>
      <mesh ref={fill} position={[0, 0.16, 0]} rotation={[-Math.PI / 2, 0, 0]} material={mats.fill} visible={false}><circleGeometry args={[1, 28]} /></mesh>
      <mesh position={[0, 0.17, 0]} rotation={[-Math.PI / 2, 0, 0]} material={RING_MAT}><ringGeometry args={[PAD_R - 0.04, PAD_R + 0.08, 32]} /></mesh>
      <mesh ref={label} position={[0, 2.7, 0]} material={mats.label} renderOrder={5}><planeGeometry args={[2.9, 1.45]} /></mesh>
    </group>
  );
}

export default function LaunchPadsView({ run, room }: { run: RunState; room: RoomRuntime }) {
  return (
    <group>
      <Hedge run={run} room={room} />
      <QuestionBoard run={run} room={room} />
      {Array.from({ length: MAX_PADS }, (_, i) => <Pad key={i} room={room} i={i} />)}
    </group>
  );
}
