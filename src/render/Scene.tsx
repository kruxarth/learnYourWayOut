import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  Color, DirectionalLight, Fog, Group, LineSegments, Object3D, BufferGeometry, Float32BufferAttribute, LineBasicMaterial,
} from 'three';
import { engine } from '../game/engine';
import { compassTarget } from '../game/loop/powerups';
import { visibilityRadius } from '../game/loop/visibility';
import { T } from '../game/tuning';
import { PAL, toon } from './materials';
import { visUniforms } from './visibility';
import type { RunState } from '../game/runtime';
import { useUI } from '../ui/store';
import Bean from './Bean';
import CameraRig from './CameraRig';
import Clouds from './Clouds';
import Confetti from './Confetti';
import DynamicEntities from './DynamicEntities';
import GameDriver from './GameDriver';
import { dailyGhostSource } from './dailyGhostSource';
import GhostPlayers from './GhostPlayers';
import HubScene from './HubScene';
import RemotePlayers from './RemotePlayers';
import { disposeLabels } from './labels';
import Sky from './Sky';
import Slime from './Slime';
import StaticFloors from './StaticFloors';
import StaticWalls from './StaticWalls';

function Lights() {
  const light = useRef<DirectionalLight>(null);
  const target = useMemo(() => new Object3D(), []);
  const isTouch = useUI((s) => s.isTouch);
  useFrame(() => {
    const l = light.current;
    if (!l) return;
    const p = engine.player.pos;
    l.position.set(p.x + 15, p.y + 30, p.z + 10);
    target.position.set(p.x, p.y, p.z);
    target.updateMatrixWorld();
  });
  return (
    <>
      <hemisphereLight args={['#CFEFFF', '#FFE2C4', 1.5]} />
      <directionalLight
        ref={light}
        intensity={2.2}
        castShadow={!isTouch}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-30} shadow-camera-right={30} shadow-camera-top={30} shadow-camera-bottom={-30}
        shadow-camera-near={1} shadow-camera-far={90}
        shadow-bias={-0.0005}
        target={target}
      />
      <primitive object={target} />
    </>
  );
}

/** Eases the visibility radius toward the engine's target and keeps its centre on the player. */
function VisibilityDriver() {
  useFrame((_, dtRaw) => {
    const run = engine.run;
    const target = run && engine.mode === 'run' ? visibilityRadius(run) : T.VIS_OPEN;
    const u = visUniforms.uVisR;
    u.value += (target - u.value) * (1 - Math.exp(-T.VIS_EASE * Math.min(dtRaw, 0.1)));
    const p = engine.player.pos;
    visUniforms.uVisPlayer.value.set(p.x, p.y, p.z);
  });
  return null;
}

/** Compass power-up: an arrow over the bean pointing along the way out of the maze. */
function CompassArrow() {
  const ref = useRef<Group>(null);
  const mat = useMemo(() => toon(PAL.gold, { emissive: new Color(PAL.gold), emissiveIntensity: 0.5 }, 'compass', false), []);
  useFrame(({ clock }) => {
    const g = ref.current, run = engine.run;
    if (!g) return;
    const p = engine.player.pos;
    const t = run && run.compassT > 0 ? compassTarget(run, p.x, p.z) : null;
    g.visible = !!t;
    if (!t) return;
    g.position.set(p.x, p.y + 2.5 + Math.sin(clock.elapsedTime * 4) * 0.08, p.z);
    g.rotation.y = Math.atan2(-(t.x - p.x), -(t.z - p.z));
  });
  return (
    <group ref={ref} visible={false}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, -0.5]} material={mat}><coneGeometry args={[0.35, 0.8, 12]} /></mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0.15]} material={mat}><cylinderGeometry args={[0.12, 0.12, 0.6, 8]} /></mesh>
    </group>
  );
}

function FogSetup({ near, far }: { near: number; far: number }) {
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    scene.fog = new Fog('#FFD9F0', near, far);
    return () => { scene.fog = null; };
  }, [scene, near, far]);
  return null;
}

/** Wireframe of every wall box (debug key B). */
function DebugBoxes({ run }: { run: RunState }) {
  const lines = useMemo(() => {
    const pos: number[] = [];
    for (const w of run.world.walls) {
      const { minX: a, minY: b, minZ: c, maxX: d, maxY: e, maxZ: f } = w;
      const v = [[a, b, c], [d, b, c], [d, b, f], [a, b, f], [a, e, c], [d, e, c], [d, e, f], [a, e, f]];
      for (const [i, j] of [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]) pos.push(...v[i], ...v[j]);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    return new LineSegments(g, new LineBasicMaterial({ color: '#ff0066' }));
  }, [run]);
  return <primitive object={lines} />;
}

function RunScene({ run }: { run: RunState }) {
  const debugBoxes = useUI((s) => s.debugBoxes);
  useEffect(() => () => disposeLabels(), []);
  return (
    <>
      <StaticFloors floors={run.world.floors} />
      <StaticWalls walls={run.world.walls} />
      <DynamicEntities run={run} />
      <Slime />
      {debugBoxes && <DebugBoxes run={run} />}
      {run.selection.mode === 'daily' && <GhostPlayers source={dailyGhostSource} />}
      {run.selection.mode === 'online' && <RemotePlayers />}
    </>
  );
}

export default function Scene() {
  const runId = useUI((s) => s.runId);
  const mode = engine.mode;
  const run = engine.run;
  const hub = engine.hub;
  const world = engine.world;
  useEffect(() => () => disposeLabels(), [runId]);
  return (
    <>
      <GameDriver />
      <VisibilityDriver />
      <CameraRig />
      <Sky />
      <Clouds />
      <Lights />
      <FogSetup near={mode === 'hub' ? 60 : 45} far={mode === 'hub' ? 160 : 140} />
      <group key={runId}>
        {mode === 'run' && run && <RunScene run={run} />}
        {mode === 'hub' && hub && <HubScene hub={hub} />}
        {mode === 'arena' && world && (<><StaticFloors floors={world.floors} /><StaticWalls walls={world.walls} /></>)}
      </group>
      <Bean />
      <CompassArrow />
      <Confetti />
    </>
  );
}
