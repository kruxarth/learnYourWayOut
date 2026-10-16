import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { BoxGeometry, Color, DoubleSide, Matrix4, MeshBasicMaterial, MeshToonMaterial, type Group, type InstancedMesh, type Mesh } from 'three';
import type { RoomRuntime, RunState } from '../game/runtime';
import { T } from '../game/tuning';
import { labelTexture } from './labels';
import { PAL, tint, toon, toonGradient } from './materials';
import { withVisibility } from './visibility';

const unit = new BoxGeometry(1, 1, 1);
const PLATE_R = 0.7;
const RING_MAT = new MeshBasicMaterial({ color: '#FFFFFF', transparent: true, opacity: 0.8, side: DoubleSide });
/** Plate label offsets from the cell centre (x, y, z): two beside the plates, one above and behind. */
const LABEL_AT: [number, number, number][] = [[-1.5, 2.7, 0.7], [1.5, 2.7, 0.7], [0, 3.9, -0.95]];
const PLATE_AT: [number, number][] = [[-0.95, 0.7], [0.95, 0.7], [0, -0.95]];

/**
 * Every interior hedge of the maze, as instances of one box. A hedge slides up or down (its wall's `enabled`
 * flag is the target), so the shrines can move them. Same look as the static hedges.
 */
function Hedges({ run, room }: { run: RunState; room: RoomRuntime }) {
  const body = useRef<InstancedMesh>(null);
  const top = useRef<InstancedMesh>(null);
  const L = room.layout.shift!;
  const ids = useMemo(() => [...L.edgesE.flat(), ...L.edgesN.flat()], [L]);
  const walls = useMemo(() => ids.map((id) => run.world.walls[id]), [ids, run]);
  const s = useRef<Float32Array>(Float32Array.from(walls.map((w) => (w.enabled ? 1 : 0))));
  const m = useMemo(() => new Matrix4(), []);
  const mat = toon('#ffffff', {}, 'white');
  const topMat = toon(PAL.hedgeTop, {}, `top${PAL.hedgeTop}`);

  useLayoutEffect(() => {
    const mesh = body.current;
    if (!mesh) return;
    const c = new Color();
    walls.forEach((w, i) => {
      const jitter = (((w.id * 2654435761) % 1000) / 1000 - 0.5) * 0.16;
      mesh.setColorAt(i, tint(PAL.hedge, jitter, c));
    });
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [walls]);

  useFrame((_, dtRaw) => {
    const b = body.current, t = top.current;
    if (!b || !t) return;
    const step = Math.min(dtRaw, 0.1) / T.SHIFT_ANIM_S;
    const cur = s.current;
    let changed = false;
    for (let i = 0; i < walls.length; i++) {
      const w = walls[i];
      const target = w.enabled ? 1 : 0;
      if (cur[i] === target && !(b.userData.init !== true)) continue;
      cur[i] += Math.max(-step, Math.min(step, target - cur[i]));
      changed = true;
      const h = Math.max(0.0001, cur[i]) * (w.maxY - w.minY);
      const sx = w.maxX - w.minX, sz = w.maxZ - w.minZ;
      m.makeScale(sx, h, sz);
      m.setPosition((w.minX + w.maxX) / 2, h / 2, (w.minZ + w.maxZ) / 2);
      b.setMatrixAt(i, m);
      const th = cur[i] > 0.02 ? 0.12 : 0.0001;
      m.makeScale(sx + 0.04, th, sz + 0.04);
      m.setPosition((w.minX + w.maxX) / 2, h - 0.05, (w.minZ + w.maxZ) / 2);
      t.setMatrixAt(i, m);
    }
    if (changed || b.userData.init !== true) {
      b.userData.init = true;
      b.instanceMatrix.needsUpdate = true; t.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <>
      <instancedMesh ref={body} args={[unit, mat, walls.length]} castShadow receiveShadow frustumCulled={false} />
      <instancedMesh ref={top} args={[unit, topMat, walls.length]} frustumCulled={false} />
    </>
  );
}

/** A glowing crystal over the shrine cell, so it can be seen over the hedges. Grey once used. */
function Crystal({ room, k }: { room: RoomRuntime; k: number }) {
  const ref = useRef<Group>(null);
  const at = room.layout.shift!.shrines[k];
  const mat = useMemo(() => withVisibility(new MeshToonMaterial({
    color: new Color('#B58CFF'), gradientMap: toonGradient(), transparent: true, emissive: new Color('#B58CFF'), emissiveIntensity: 0.5,
  })), []);
  useEffect(() => () => mat.dispose(), [mat]);
  useFrame(({ clock }) => {
    const g = ref.current;
    if (!g) return;
    const sh = room.shift?.shrines[k];
    const t = clock.elapsedTime;
    g.position.set(at.x, 2.9 + Math.sin(t * 2 + k) * 0.15, at.z);
    g.rotation.y = t * 1.4;
    const done = sh?.state === 'done';
    const col = done ? (sh!.right ? PAL.good : PAL.bad) : sh?.state === 'asking' ? PAL.gold : '#B58CFF';
    mat.color.set(col); mat.emissive.set(col);
    mat.emissiveIntensity = done ? 0.15 : 0.5 + 0.25 * Math.sin(t * 5);
  });
  return (
    <group ref={ref}>
      <mesh material={mat} castShadow><octahedronGeometry args={[0.55, 0]} /></mesh>
    </group>
  );
}

/** A pressure plate: a disc on the floor, a ring that fills while the bean stands on it, and its answer floating beside it. */
function Plate({ room, k, i }: { room: RoomRuntime; k: number; i: number }) {
  const root = useRef<Group>(null);
  const fill = useRef<Mesh>(null);
  const label = useRef<Mesh>(null);
  const last = useRef('');
  const camera = useThree((s) => s.camera);
  const at = room.layout.shift!.shrines[k];
  const mats = useMemo(() => ({
    disc: withVisibility(new MeshToonMaterial({ color: new Color('#B58CFF'), gradientMap: toonGradient(), transparent: true })),
    fill: new MeshBasicMaterial({ color: PAL.gold, transparent: true, opacity: 0.85, depthWrite: false }),
    label: withVisibility(new MeshBasicMaterial({ transparent: true, depthTest: false })),
  }), []);
  useEffect(() => () => { mats.disc.dispose(); mats.fill.dispose(); mats.label.dispose(); }, [mats]);
  useFrame(() => {
    const r = root.current, f = fill.current, l = label.current;
    if (!r || !f || !l) return;
    const sh = room.shift?.shrines[k];
    const pl = sh?.plates[i];
    // plates show while the shrine asks, and afterwards as the verdict (the right one green, the chosen wrong one red)
    if (!sh || !pl || sh.state === 'idle') { r.visible = false; return; }
    r.visible = true;
    r.position.set(at.x + PLATE_AT[i][0], 0, at.z + PLATE_AT[i][1]);
    const bad = pl.state === 'wrong', good = pl.state === 'right';
    mats.disc.color.set(bad ? PAL.bad : good ? PAL.good : '#B58CFF');
    mats.disc.emissive.set(bad ? PAL.bad : good ? PAL.good : PAL.gold);
    mats.disc.emissiveIntensity = bad || good ? 0.3 : pl.charge * 0.6;
    f.visible = pl.charge > 0.01;
    f.scale.setScalar(Math.max(0.01, pl.charge) * (PLATE_R - 0.08));
    const text = bad ? `✗ ${pl.label}` : pl.label;
    const key = `${text}|${pl.state}`;
    if (key !== last.current) {
      last.current = key;
      mats.label.map = labelTexture({
        text, w: 640, h: 320, maxLines: 2,
        bg: bad ? '#FFE3E7' : good ? '#D8FFE6' : '#FFFFFF', fg: bad ? PAL.bad : good ? '#16794A' : PAL.uiText,
        border: bad ? PAL.bad : good ? PAL.good : PAL.panelBorder,
      });
      mats.label.needsUpdate = true;
    }
    l.position.set(LABEL_AT[i][0] - PLATE_AT[i][0], LABEL_AT[i][1], LABEL_AT[i][2] - PLATE_AT[i][1]);
    l.quaternion.copy(camera.quaternion);
  });
  return (
    <group ref={root} visible={false}>
      <mesh position={[0, 0.05, 0]} material={mats.disc} receiveShadow><cylinderGeometry args={[PLATE_R, PLATE_R, 0.1, 24]} /></mesh>
      <mesh ref={fill} position={[0, 0.12, 0]} rotation={[-Math.PI / 2, 0, 0]} material={mats.fill} visible={false}><circleGeometry args={[1, 24]} /></mesh>
      <mesh position={[0, 0.13, 0]} rotation={[-Math.PI / 2, 0, 0]} material={RING_MAT}><ringGeometry args={[PLATE_R - 0.04, PLATE_R + 0.06, 28]} /></mesh>
      <mesh ref={label} material={mats.label} renderOrder={5}><planeGeometry args={[2.4, 1.2]} /></mesh>
    </group>
  );
}

export default function ShiftMazeView({ run, room }: { run: RunState; room: RoomRuntime }) {
  const L = room.layout.shift!;
  return (
    <group>
      <Hedges run={run} room={room} />
      {L.shrines.map((_, k) => (
        <group key={k}>
          <Crystal room={room} k={k} />
          {[0, 1, 2].map((i) => <Plate key={i} room={room} k={k} i={i} />)}
        </group>
      ))}
    </group>
  );
}
