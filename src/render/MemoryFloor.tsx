import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Color, MeshBasicMaterial, MeshToonMaterial, type Mesh } from 'three';
import type { RoomRuntime, RunState } from '../game/runtime';
import { T } from '../game/tuning';
import { labelTexture } from './labels';
import { PAL, toonGradient } from './materials';
import { withVisibility } from './visibility';

/**
 * Memory Floor extras (the tiles themselves are drawn by TileMesh): a board above the field that counts
 * the memorising time down and then shows the question, and the bridge that rises after a right answer.
 */
export default function MemoryFloorView({ run, room }: { run: RunState; room: RoomRuntime }) {
  const board = useRef<Mesh>(null);
  const bridge = useRef<Mesh>(null);
  const last = useRef('');
  const L = room.layout;
  const mats = useMemo(() => ({
    board: withVisibility(new MeshBasicMaterial({ transparent: true })),
    bridge: withVisibility(new MeshToonMaterial({ color: new Color(PAL.good), gradientMap: toonGradient(), transparent: true, opacity: 0.9 })),
  }), []);
  useEffect(() => () => { mats.board.dispose(); mats.bridge.dispose(); }, [mats]);
  const z0 = L.z0 - 4, z1 = L.z0 - 16;
  const reveal = T.MEMORY_REVEAL_S[run.selection.difficulty];

  useFrame(({ clock }) => {
    const m = room.memory, b = board.current, br = bridge.current;
    if (!b || !br) return;
    const show = !!m && room.state !== 'idle' && m.phase !== 'done';
    b.visible = show;
    if (show && m) {
      const secs = Math.max(0, Math.ceil(reveal - m.t));
      const text = m.phase === 'reveal' ? `MEMORISE!  ${secs}` : room.question?.prompt ?? '';
      if (text !== last.current) {
        last.current = text;
        mats.board.map = labelTexture({ text, w: 1024, h: 320, maxLines: 3, border: m.phase === 'reveal' ? PAL.gold : PAL.uiAccent, bg: '#FFFFFF' });
        mats.board.needsUpdate = true;
      }
    }
    const a = m?.bridge ?? 0;
    br.visible = a > 0;
    if (a > 0) {
      br.scale.set(1, 1, Math.max(0.01, a) * (z0 - z1));
      br.position.set(L.laneX, 0.08, z0 - (a * (z0 - z1)) / 2);
    }
    void clock;
  });

  return (
    <group>
      <mesh ref={board} position={[L.laneX, 5, z1 - 0.5]} material={mats.board} visible={false}>
        <planeGeometry args={[11, 3.4]} />
      </mesh>
      <mesh ref={bridge} material={mats.bridge} visible={false}>
        <boxGeometry args={[3, 0.12, 1]} />
      </mesh>
    </group>
  );
}
