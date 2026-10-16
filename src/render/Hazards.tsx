import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { CanvasTexture, Color, MeshBasicMaterial, SRGBColorSpace, type Group, type Mesh } from 'three';
import { engine } from '../game/engine';
import { sweeperAngle } from '../game/loop/hazards';
import type { RunState } from '../game/runtime';
import { T } from '../game/tuning';
import type { Hazard } from '../game/types';
import { PAL, toon } from './materials';
import { withVisibility } from './visibility';

/** F4-4: sweepers, hammers and ice patches. All motion is read from the engine's hazard clock in `useFrame`. */

const BAR = toon(PAL.bad, {}, 'sweeperBar');
const TIP = toon(PAL.gold, {}, 'sweeperTip');
const POST = toon('#FFFFFF', {}, 'sweeperPost');
const HEAD = toon(PAL.bad, {}, 'hammerHead');
const ROD = toon('#8D8DA8', {}, 'hammerRod');

function Sweeper({ run, h }: { run: RunState; h: Hazard }) {
  const bar = useRef<Group>(null);
  const omega = T.SWEEPER_OMEGA[run.selection.difficulty];
  useFrame(() => {
    const g = bar.current;
    if (g) g.rotation.y = -sweeperAngle(h, run.hazardMs, omega);
  });
  const len = h.hw * 2;
  return (
    <group position={[h.x, 0, h.z]}>
      <mesh position={[0, 0.5, 0]} material={POST} castShadow><cylinderGeometry args={[0.4, 0.5, 1.0, 14]} /></mesh>
      <group ref={bar}>
        <mesh position={[0, 0.55, 0]} material={BAR} castShadow><boxGeometry args={[len, 0.7, T.SWEEPER_THICK]} /></mesh>
        <mesh position={[len / 2 - 0.2, 0.55, 0]} material={TIP}><boxGeometry args={[0.42, 0.74, T.SWEEPER_THICK + 0.04]} /></mesh>
        <mesh position={[-len / 2 + 0.2, 0.55, 0]} material={TIP}><boxGeometry args={[0.42, 0.74, T.SWEEPER_THICK + 0.04]} /></mesh>
      </group>
    </group>
  );
}

function Hammer({ h }: { h: Hazard }) {
  const head = useRef<Group>(null);
  const w = h.head!;
  useFrame(() => {
    const g = head.current;
    if (g) g.position.x = (w.minX + w.maxX) / 2;
  });
  const beam = h.hw * 2 + 1.4;
  return (
    <group position={[0, 0, h.z]}>
      <mesh position={[h.x, 3.6, 0]} material={ROD}><boxGeometry args={[beam, 0.3, 0.3]} /></mesh>
      <group ref={head} position={[h.x, 0, 0]}>
        <mesh position={[0, 2.6, 0]} material={ROD}><boxGeometry args={[0.16, 2.0, 0.16]} /></mesh>
        <mesh position={[0, T.HAMMER_H / 2, 0]} material={HEAD} castShadow>
          <boxGeometry args={[T.HAMMER_HW * 2, T.HAMMER_H, T.HAMMER_HD * 2]} />
        </mesh>
      </group>
    </group>
  );
}

// ice reads as a glossy sheet with shine streaks: no symbol, so it can't be mistaken for a pickup or the Slime Freeze power-up
let iceTex: CanvasTexture | null = null;
function iceTexture(): CanvasTexture {
  if (iceTex) return iceTex;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#DDF6FF';
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(255,255,255,0.9)';
  g.lineCap = 'round';
  // [x0, y0, length, width]: fixed diagonal shine streaks
  const streaks = [[30, 70, 90, 10], [70, 60, 40, 5], [120, 200, 110, 12], [160, 120, 60, 6], [40, 190, 50, 6], [190, 40, 50, 8]];
  for (const [x, y, len, w] of streaks) {
    g.lineWidth = w;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + len * 0.7, y - len * 0.7); g.stroke();
  }
  g.strokeStyle = '#FFFFFF';
  g.lineWidth = 10;
  g.strokeRect(5, 5, 246, 246);
  iceTex = new CanvasTexture(c);
  iceTex.colorSpace = SRGBColorSpace;
  return iceTex;
}

function IcePatch({ h }: { h: Hazard }) {
  const mat = useMemo(() => withVisibility(new MeshBasicMaterial({ map: iceTexture(), transparent: true, opacity: 0.92, depthWrite: false })), []);
  useEffect(() => () => mat.dispose(), [mat]);
  return (
    <mesh position={[h.x, 0.025, h.z]} rotation={[-Math.PI / 2, 0, 0]} material={mat}>
      <planeGeometry args={[h.hw * 2, h.hd * 2]} />
    </mesh>
  );
}

export default function Hazards({ run }: { run: RunState }) {
  return (
    <>
      {run.course.hazards.map((h) => {
        if (h.kind === 'sweeper') return <Sweeper key={h.id} run={run} h={h} />;
        if (h.kind === 'hammer') return <Hammer key={h.id} h={h} />;
        return <IcePatch key={h.id} h={h} />;
      })}
      <ShieldBubble run={run} />
    </>
  );
}

/** The Shield power-up: a soft bubble around the bean while it is armed. */
function ShieldBubble({ run }: { run: RunState }) {
  const ref = useRef<Mesh>(null);
  const mat = useMemo(() => new MeshBasicMaterial({ color: new Color('#7DF9FF'), transparent: true, opacity: 0.28, depthWrite: false }), []);
  useEffect(() => () => mat.dispose(), [mat]);
  useFrame(({ clock }) => {
    const m = ref.current;
    if (!m) return;
    m.visible = run.shield;
    if (!run.shield) return;
    const p = engine.player.pos;
    m.position.set(p.x, p.y + 0.8, p.z);
    const s = 1 + Math.sin(clock.elapsedTime * 6) * 0.04;
    m.scale.set(s, s, s);
  });
  return <mesh ref={ref} material={mat} visible={false}><sphereGeometry args={[1.0, 20, 14]} /></mesh>;
}
