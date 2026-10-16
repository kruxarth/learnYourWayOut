import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Group, MeshBasicMaterial, type Mesh } from 'three';
import { engine } from '../game/engine';
import type { RunState } from '../game/runtime';
import { correctText } from '../game/rooms/detour';
import { boardTexture } from './labels';
import { PAL, toon } from './materials';

function BoardFrame({ x, z, mat, y = 2.4, posts = true }: { x: number; z: number; mat: MeshBasicMaterial; y?: number; posts?: boolean }) {
  return (
    <group position={[x, 0, z]}>
      {posts && <mesh position={[-1.6, y / 2 - 0.3, 0]} material={toon('#FFFFFF', {}, 'white')}><cylinderGeometry args={[0.12, 0.12, y - 0.6, 8]} /></mesh>}
      {posts && <mesh position={[1.6, y / 2 - 0.3, 0]} material={toon('#FFFFFF', {}, 'white')}><cylinderGeometry args={[0.12, 0.12, y - 0.6, 8]} /></mesh>}
      <group position={[0, y, 0]}>
        <mesh material={toon(PAL.detourHedge, {}, 'board')} castShadow><boxGeometry args={[4.2, 2.6, 0.2]} /></mesh>
        <mesh position={[0, 0, 0.11]} material={mat}><planeGeometry args={[4, 2]} /></mesh>
      </group>
    </group>
  );
}

/**
 * Junction Hall remediation (P1-D): after a wrong answer the scenic lane opens with two boards,
 * the answer with its explanation and the worked example, so the learning happens on the way.
 */
export function ScenicBoards({ run }: { run: RunState }) {
  const sb = run.course.scenicBoards;
  const mats = useMemo(() => ({ a: new MeshBasicMaterial(), b: new MeshBasicMaterial() }), []);
  useEffect(() => () => { mats.a.dispose(); mats.b.dispose(); }, [mats]);
  const root = useRef<Group>(null);
  const last = useRef('');
  useFrame(() => {
    if (!sb || !root.current) return;
    const room = run.roomMap.get(sb.roomId);
    const q = room?.question;
    const show = !!room && room.result === 'wrongCompleted' && !!q;
    root.current.visible = show;
    if (!show || !q || q.id === last.current) return;
    last.current = q.id;
    mats.a.map = boardTexture('NOT QUITE', `Answer: ${correctText(q)}. ${q.explanation}`);
    mats.b.map = boardTexture('WORKED EXAMPLE', q.workedExample ?? `Remember: ${q.hint}`, '#FFFFFF', '#9B7BFF', '#E8590C');
    mats.a.needsUpdate = true; mats.b.needsUpdate = true;
  });
  if (!sb) return null;
  return (
    <group ref={root} visible={false}>
      <BoardFrame x={sb.a.x} z={sb.a.z} mat={mats.a} y={3.6} posts={false} />
      <BoardFrame x={sb.b.x} z={sb.b.z} mat={mats.b} y={3.6} posts={false} />
    </group>
  );
}

function Board({ x, z, which }: { x: number; z: number; which: 'A' | 'B' }) {
  const mat = useMemo(() => new MeshBasicMaterial({ map: boardTexture(which === 'A' ? 'NOT QUITE' : 'WORKED EXAMPLE', which === 'A' ? 'Answer the question wrong and it shows up here.' : 'Learn it, then get back on track.') }), [which]);
  const lastKey = useRef('');
  const near = useRef<Mesh>(null);
  useFrame(() => {
    const d = engine.run?.detour;
    const key = d ? `${d.question.id}` : '';
    if (key !== lastKey.current) {
      lastKey.current = key;
      if (d) {
        const q = d.question;
        mat.map = which === 'A'
          ? boardTexture('NOT QUITE', `Answer: ${correctText(q)}. ${q.explanation}`)
          : boardTexture('WORKED EXAMPLE', q.workedExample ?? `Remember: ${q.hint}`, '#FFFFFF', '#9B7BFF', '#E8590C');
        mat.needsUpdate = true;
      }
    }
    if (near.current) near.current.scale.setScalar(d && d.nearBoard === which ? 1.04 : 1);
  });
  return (
    <group position={[x, 0, z]}>
      <mesh position={[-1.6, 0.9, 0]} material={toon('#FFFFFF', {}, 'white')}><cylinderGeometry args={[0.12, 0.12, 1.8, 8]} /></mesh>
      <mesh position={[1.6, 0.9, 0]} material={toon('#FFFFFF', {}, 'white')}><cylinderGeometry args={[0.12, 0.12, 1.8, 8]} /></mesh>
      <group ref={near} position={[0, 2.4, 0]}>
        <mesh material={toon(PAL.detourHedge, {}, 'board')} castShadow><boxGeometry args={[4.2, 2.6, 0.2]} /></mesh>
        <mesh position={[0, 0, 0.11]} material={mat}><planeGeometry args={[4, 2]} /></mesh>
      </group>
    </group>
  );
}

export default function DetourBoards({ run }: { run: RunState }) {
  const d = run.course.detour;
  return (
    <>
      <Board x={d.boardA.x} z={d.boardA.z} which="A" />
      <Board x={d.boardB.x} z={d.boardB.z} which="B" />
    </>
  );
}
