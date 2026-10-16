import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Color, Group, MeshBasicMaterial, MeshToonMaterial, type Mesh } from 'three';
import type { RoomRuntime, RunState } from '../game/runtime';
import { T } from '../game/tuning';
import { labelTexture } from './labels';
import { PAL, toon, toonGradient } from './materials';
import { withVisibility } from './visibility';

const MAX_LIFTS = 4;
const LIFT_THICK = 0.4;

const PILLAR_MAT = toon(PAL.roomWall, {}, 'liftPillar');

/** The ledge's block, from the pond bottom up to the ledge (the floor slab itself is a static floor). */
function LedgeBlock({ room }: { room: RoomRuntime }) {
  const L = room.layout.lifts!;
  const depth = L.ledgeZ - L.ledgeEndZ;
  const h = T.LIFT_TOP - T.LIFT_PIT - 0.4;
  return (
    <mesh position={[room.layout.laneX, T.LIFT_PIT + h / 2, (L.ledgeZ + L.ledgeEndZ) / 2]} scale={[20, h, depth]} material={PILLAR_MAT} receiveShadow castShadow>
      <boxGeometry args={[1, 1, 1]} />
    </mesh>
  );
}

/** One lift: a slab that follows its floor, with a floating answer label and a boarding ring. */
function Lift({ run, room, i }: { run: RunState; room: RoomRuntime; i: number }) {
  const L = room.layout.lifts!;
  const root = useRef<Group>(null);
  const label = useRef<Mesh>(null);
  const fill = useRef<Mesh>(null);
  const lastKey = useRef('');
  const camera = useThree((s) => s.camera);
  const mats = useMemo(() => ({
    slab: withVisibility(new MeshToonMaterial({ color: new Color('#7DF9FF'), gradientMap: toonGradient(), transparent: true })),
    fill: new MeshBasicMaterial({ color: PAL.gold, transparent: true, opacity: 0.85, depthWrite: false }),
    label: withVisibility(new MeshBasicMaterial({ transparent: true, depthTest: false })),
  }), []);
  useEffect(() => () => { mats.slab.dispose(); mats.fill.dispose(); mats.label.dispose(); }, [mats]);
  const floor = run.world.floors[L.floorIds[i]];

  useFrame(({ clock }) => {
    const r = root.current, l = label.current, f = fill.current;
    if (!r || !l || !f) return;
    const lift = room.lifts?.[i];
    r.position.set(L.xs[i], floor.top, L.z);
    const bad = lift?.state === 'wrong';
    mats.slab.color.set(bad ? PAL.bad : '#7DF9FF');
    mats.slab.emissive.set(bad ? PAL.bad : PAL.gold);
    mats.slab.emissiveIntensity = bad ? 0.2 : (lift?.charge ?? 0) * 0.6;
    f.visible = !!lift && lift.charge > 0.01;
    f.scale.setScalar(Math.max(0.01, lift?.charge ?? 0) * (L.half - 0.2));
    const text = lift ? (bad ? `X ${lift.label}` : lift.label) : '';
    l.visible = !!lift;
    if (text !== lastKey.current && lift) {
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
    <group ref={root}>
      <mesh position={[0, -LIFT_THICK / 2, 0]} scale={[L.half * 2 - 0.1, LIFT_THICK, L.half * 2 - 0.1]} material={mats.slab} castShadow receiveShadow>
        <boxGeometry args={[1, 1, 1]} />
      </mesh>
      <mesh ref={fill} position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]} material={mats.fill} visible={false}><circleGeometry args={[1, 28]} /></mesh>
      <mesh ref={label} position={[0, 2.7, 0]} material={mats.label} renderOrder={5} visible={false}><planeGeometry args={[2.9, 1.45]} /></mesh>
    </group>
  );
}

export default function AnswerLiftsView({ run, room }: { run: RunState; room: RoomRuntime }) {
  const n = room.layout.lifts!.xs.length;
  return (
    <group>
      <LedgeBlock room={room} />
      {Array.from({ length: Math.min(MAX_LIFTS, n) }, (_, i) => <Lift key={i} run={run} room={room} i={i} />)}
    </group>
  );
}
