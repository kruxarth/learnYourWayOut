import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Group, MeshBasicMaterial, type Mesh } from 'three';
import type { BranchRT, RoomRuntime, RunState } from '../game/runtime';
import type { BranchLayout } from '../game/types';
import { labelTexture } from './labels';
import { PAL } from './materials';
import { T } from '../game/tuning';
import { visOpacity } from './visibility';

const SIGN_W = 2.8, SIGN_H = 1.4, SIGN_Y = 2.4, INSET = 0.9;

function style(b: BranchRT): { text: string; bg: string; fg: string; border: string } {
  switch (b.state) {
    case 'idle': return { text: '?', bg: '#EEF4FF', fg: '#5A7BA6', border: PAL.tile };
    case 'right': return { text: b.label, bg: '#D8FFE6', fg: '#16794A', border: PAL.good };
    case 'wrong': return { text: `✗ ${b.label}`, bg: '#FFE3E7', fg: PAL.bad, border: PAL.bad };
    case 'crossed': return { text: '✗', bg: '#E6E6EE', fg: PAL.bad, border: '#B8B8C4' };
    default: return b.glow
      ? { text: b.label, bg: '#FFF6CC', fg: PAL.uiText, border: PAL.gold }
      : { text: b.label, bg: '#FFFFFF', fg: PAL.uiText, border: PAL.panelBorder };
  }
}

/**
 * An answer sign hanging over a corridor mouth (P0-A). It turns to face the camera, carries the
 * runtime label, and fades out beyond the visibility radius so far junctions don't give the path away.
 */
function Sign({ layout, get }: { layout: BranchLayout; get: () => BranchRT }) {
  const root = useRef<Group>(null);
  const board = useRef<Mesh>(null);
  const last = useRef('');
  const mat = useMemo(() => new MeshBasicMaterial({ transparent: true, depthWrite: false }), []);
  useEffect(() => () => mat.dispose(), [mat]);
  const x = layout.signX + layout.dx * INSET, z = layout.signZ + layout.dz * INSET;

  useFrame(({ camera, clock }) => {
    const r = root.current;
    if (!r) return;
    const b = get();
    // fade a sign the camera is right beside (the corridor behind the bean), so it never fills the view
    const [n0, n1] = T.SIGN_NEAR_FADE;
    const near = Math.min(1, Math.max(0, (Math.hypot(camera.position.x - x, camera.position.z - z) - n0) / (n1 - n0)));
    const op = visOpacity(x, z) * near;
    r.visible = op > 0.02;
    if (!r.visible) return;
    mat.opacity = op;
    r.rotation.y = Math.atan2(camera.position.x - x, camera.position.z - z);
    const st = style(b);
    const key = `${st.text}|${st.bg}|${st.border}`;
    if (key !== last.current) {
      last.current = key;
      mat.map = labelTexture({ ...st, w: 512, h: 256 });
      mat.needsUpdate = true;
    }
    if (board.current) board.current.scale.setScalar(b.glow && b.state === 'open' ? 1 + 0.06 * Math.sin(clock.elapsedTime * 7) : 1);
  });

  return (
    <group ref={root} position={[x, 0, z]}>
      <mesh ref={board} position={[0, SIGN_Y, 0]} material={mat} renderOrder={4}>
        <planeGeometry args={[SIGN_W, SIGN_H]} />
      </mesh>
    </group>
  );
}

function QuizMazeSigns({ room }: { room: RoomRuntime }) {
  return (
    <>
      {room.layout.junctions.map((j) => j.branches.map((b, bi) => (
        <Sign key={`${j.index}:${bi}`} layout={b} get={() => room.junctions[j.index].branches[bi]} />
      )))}
    </>
  );
}

export default function QuizSigns({ run }: { run: RunState }) {
  return <>{run.rooms.filter((r) => r.kind === 'quizMaze').map((r) => <QuizMazeSigns key={r.id} room={r} />)}</>;
}
