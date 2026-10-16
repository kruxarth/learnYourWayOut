import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Color, CylinderGeometry, MeshBasicMaterial, type Mesh } from 'three';
import type { RoomRuntime, RunState } from '../game/runtime';
import { labelTexture } from './labels';
import { PAL, toon } from './materials';
import { withVisibility } from './visibility';

const CLUSTER_COLORS = ['#FF8FB1', '#7DF9FF', '#FFD66B', '#B28DFF'];
const THICK = 0.5;
const MAX_CLUSTERS = 4;

const NEUTRAL = toon(PAL.tile, {}, 'hexNeutral');
const CLUSTER_MATS = CLUSTER_COLORS.map((c, i) => toon(c, {}, `hexCluster${i}`));
const WARN_MAT = toon(PAL.bad, { emissive: new Color(PAL.bad), emissiveIntensity: 0.5 }, 'hexWarn');
const SLAB_MAT = toon(PAL.floorRoom, {}, 'hexSlab');

/** One hex prism (pointy-top: a 6-sided cylinder, vertex toward +z). */
function Tile({ run, room, i, geo }: { run: RunState; room: RoomRuntime; i: number; geo: CylinderGeometry }) {
  const ref = useRef<Mesh>(null);
  const tile = room.hex!.tiles[i];
  const floor = run.world.floors[tile.floorId];
  useFrame(({ clock }) => {
    const m = ref.current;
    if (!m) return;
    const hx = room.hex!;
    if (tile.state === 'gone') { m.visible = false; return; }
    m.visible = true;
    let ox = 0, oz = 0;
    if (tile.state === 'shaking') {
      const k = clock.elapsedTime * 55;
      ox = Math.sin(k + i) * 0.07; oz = Math.cos(k * 1.3 + i) * 0.07;
    }
    m.position.set(tile.cx + ox, floor.top - THICK / 2, tile.cz + oz);
    const started = room.state !== 'idle' && hx.round > 0;
    if (tile.state === 'shaking') m.material = WARN_MAT;
    else m.material = started && !tile.removed ? CLUSTER_MATS[tile.cluster % CLUSTER_MATS.length] : NEUTRAL;
  });
  return <mesh ref={ref} geometry={geo} material={NEUTRAL} castShadow receiveShadow />;
}

/** The answer label floating over one colour cluster. */
function ClusterLabel({ room, ci }: { room: RoomRuntime; ci: number }) {
  const ref = useRef<Mesh>(null);
  const lastKey = useRef('');
  const camera = useThree((s) => s.camera);
  const mat = useMemo(() => withVisibility(new MeshBasicMaterial({ transparent: true, depthTest: false })), []);
  useEffect(() => () => mat.dispose(), [mat]);
  useFrame(() => {
    const m = ref.current;
    if (!m) return;
    const hx = room.hex!;
    const c = hx.clusters[ci];
    const show = !!c && room.state === 'active' && hx.phase === 'ask';
    m.visible = show;
    if (!show || !c) return;
    m.position.set(c.cx, 2.6, c.cz);
    m.quaternion.copy(camera.quaternion);
    const key = `${hx.round}|${c.label}`;
    if (key !== lastKey.current) {
      lastKey.current = key;
      mat.map = labelTexture({ text: c.label, w: 640, h: 320, maxLines: 2, bg: '#FFFFFF', fg: PAL.uiText, border: CLUSTER_COLORS[ci % CLUSTER_COLORS.length] });
      mat.needsUpdate = true;
    }
  });
  return <mesh ref={ref} material={mat} renderOrder={5} visible={false}><planeGeometry args={[3.2, 1.6]} /></mesh>;
}

/** A flat slab that follows a floor's `enabled` flag (the doorstep, the exit platform). */
function Slab({ run, floorId }: { run: RunState; floorId: number }) {
  const ref = useRef<Mesh>(null);
  const f = run.world.floors[floorId];
  useFrame(() => { if (ref.current) ref.current.visible = f.enabled; });
  return (
    <mesh ref={ref} position={[(f.minX + f.maxX) / 2, -0.2, (f.minZ + f.maxZ) / 2]} scale={[f.maxX - f.minX, 0.4, f.maxZ - f.minZ]} material={SLAB_MAT} receiveShadow>
      <boxGeometry args={[1, 1, 1]} />
    </mesh>
  );
}

export default function HexFinaleView({ run, room }: { run: RunState; room: RoomRuntime }) {
  const L = room.layout.hex!;
  const geo = useMemo(() => new CylinderGeometry(L.size * 0.97, L.size * 0.97, THICK, 6), [L.size]);
  useEffect(() => () => geo.dispose(), [geo]);
  return (
    <group>
      <Slab run={run} floorId={L.doorstepFloorId} />
      <Slab run={run} floorId={L.exitFloorId} />
      {L.cells.map((_, i) => <Tile key={i} run={run} room={room} i={i} geo={geo} />)}
      {Array.from({ length: MAX_CLUSTERS }, (_, ci) => <ClusterLabel key={ci} room={room} ci={ci} />)}
    </group>
  );
}
