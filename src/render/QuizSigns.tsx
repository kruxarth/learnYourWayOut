import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Group, MeshBasicMaterial, Vector3, type Mesh } from 'three';
import type { BranchRT, RoomRuntime, RunState } from '../game/runtime';
import type { JunctionLayout } from '../game/types';
import { branchArrow, type PathArrow } from '../game/rooms/quizMaze';
import { labelTexture } from './labels';
import { PAL } from './materials';
import { T } from '../game/tuning';
import { visOpacity } from './visibility';

// boards fit inside the junction cell (3.4 m between hedges) so a hedge corner can never hide one
const BOARD_W = 3.0, BOARD_H = 0.7, BOARD_GAP = 0.06, BOTTOM_Y = 2.2;

function withArrow(text: string, arrow: PathArrow): string {
  return arrow === '→' ? `${text}  →` : `${arrow}  ${text}`;
}

function style(b: BranchRT, arrow: PathArrow): { text: string; bg: string; fg: string; border: string } {
  switch (b.state) {
    case 'idle': return { text: withArrow('?', arrow), bg: '#EEF4FF', fg: '#5A7BA6', border: PAL.tile };
    case 'right': return { text: withArrow(b.label, arrow), bg: '#D8FFE6', fg: '#16794A', border: PAL.good };
    case 'wrong': return { text: withArrow(`✗ ${b.label}`, arrow), bg: '#FFE3E7', fg: PAL.bad, border: PAL.bad };
    case 'crossed': return { text: withArrow(`✗ ${b.label}`, arrow), bg: '#E6E6EE', fg: '#9A9CB0', border: '#B8B8C4' };
    default: return b.glow
      ? { text: withArrow(b.label, arrow), bg: '#FFF6CC', fg: PAL.uiText, border: PAL.gold }
      : { text: withArrow(b.label, arrow), bg: '#FFFFFF', fg: PAL.uiText, border: PAL.panelBorder };
  }
}

const camDir = new Vector3();

/** One board of the signpost: its corridor's answer and an arrow showing which way that corridor lies. */
function Board({ y, dx, dz, get }: { y: number; dx: number; dz: number; get: () => BranchRT }) {
  const board = useRef<Mesh>(null);
  const last = useRef('');
  const mat = useMemo(() => new MeshBasicMaterial({ transparent: true, depthWrite: false }), []);
  useEffect(() => () => mat.dispose(), [mat]);

  useFrame(({ camera, clock }) => {
    const m = board.current;
    if (!m) return;
    const b = get();
    camera.getWorldDirection(camDir);
    const st = style(b, branchArrow(dx, dz, Math.atan2(-camDir.x, -camDir.z)));
    const key = `${st.text}|${st.bg}|${st.border}`;
    if (key !== last.current) {
      last.current = key;
      mat.map = labelTexture({ ...st, w: 640, h: 150, radius: 28 });
      mat.needsUpdate = true;
    }
    m.scale.setScalar(b.glow && b.state === 'open' ? 1 + 0.05 * Math.sin(clock.elapsedTime * 7) : 1);
  });

  return (
    <mesh ref={board} position={[0, y, 0]} material={mat} renderOrder={4}>
      <planeGeometry args={[BOARD_W, BOARD_H]} />
    </mesh>
  );
}

/**
 * A signpost hanging over a junction (P0-A): one board per corridor, each with an arrow from the
 * camera's heading. It sits inside the junction cell and turns to face the camera, and fades out
 * beyond the visibility radius (so far junctions don't give the path away) and when the camera
 * passes under it.
 */
function Signpost({ junction, room }: { junction: JunctionLayout; room: RoomRuntime }) {
  const root = useRef<Group>(null);
  const { x, z } = junction;

  useFrame(({ camera }) => {
    const r = root.current;
    if (!r) return;
    const [n0, n1] = T.SIGN_NEAR_FADE;
    const near = Math.min(1, Math.max(0, (Math.hypot(camera.position.x - x, camera.position.z - z) - n0) / (n1 - n0)));
    const op = visOpacity(x, z) * near;
    r.visible = op > 0.02;
    if (!r.visible) return;
    r.rotation.y = Math.atan2(camera.position.x - x, camera.position.z - z);
    r.traverse((o) => { if ((o as Mesh).isMesh) ((o as Mesh).material as MeshBasicMaterial).opacity = op; });
  });

  const n = junction.branches.length;
  return (
    <group ref={root} position={[x, 0, z]}>
      {junction.branches.map((b, bi) => (
        <Board
          key={bi} dx={b.dx} dz={b.dz} get={() => room.junctions[junction.index].branches[bi]}
          y={BOTTOM_Y + BOARD_H / 2 + (n - 1 - bi) * (BOARD_H + BOARD_GAP)}
        />
      ))}
    </group>
  );
}

function QuizMazeSigns({ room }: { room: RoomRuntime }) {
  return <>{room.layout.junctions.map((j) => <Signpost key={j.index} junction={j} room={room} />)}</>;
}

export default function QuizSigns({ run }: { run: RunState }) {
  return <>{run.rooms.filter((r) => r.kind === 'quizMaze').map((r) => <QuizMazeSigns key={r.id} room={r} />)}</>;
}
