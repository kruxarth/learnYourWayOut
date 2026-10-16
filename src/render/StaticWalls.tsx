import { useLayoutEffect, useMemo, useRef } from 'react';
import { BoxGeometry, Color, Matrix4, type InstancedMesh } from 'three';
import type { WallBox, WallKind } from '../game/types';
import { PAL, tint, toon } from './materials';

const COLORS: Partial<Record<WallKind, string>> = {
  hedge: PAL.hedge, room: PAL.roomWall, doorWall: PAL.doorWall, detourHedge: PAL.detourHedge,
};

const unit = new BoxGeometry(1, 1, 1);

function Group({ kind, walls }: { kind: WallKind; walls: WallBox[] }) {
  const ref = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new Matrix4();
    const c = new Color();
    const base = COLORS[kind] ?? PAL.hedge;
    for (let i = 0; i < walls.length; i++) {
      const w = walls[i];
      m.makeScale(w.maxX - w.minX, w.maxY - w.minY, w.maxZ - w.minZ);
      m.setPosition((w.minX + w.maxX) / 2, (w.minY + w.maxY) / 2, (w.minZ + w.maxZ) / 2);
      mesh.setMatrixAt(i, m);
      const jitter = kind === 'hedge' || kind === 'detourHedge' ? (((w.id * 2654435761) % 1000) / 1000 - 0.5) * 0.16 : 0;
      mesh.setColorAt(i, tint(base, jitter, c));
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [kind, walls]);
  const mat = toon('#ffffff', {}, 'white');
  const hedgeLike = kind === 'hedge' || kind === 'detourHedge';
  return (
    <>
      <instancedMesh ref={ref} args={[unit, mat, walls.length]} castShadow receiveShadow frustumCulled={false} />
      {hedgeLike && <HedgeTops walls={walls} color={kind === 'hedge' ? PAL.hedgeTop : '#B9A2FF'} />}
    </>
  );
}

/** Thin lighter boxes on top of each hedge (P1 detail). */
function HedgeTops({ walls, color }: { walls: WallBox[]; color: string }) {
  const ref = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new Matrix4();
    for (let i = 0; i < walls.length; i++) {
      const w = walls[i];
      m.makeScale(w.maxX - w.minX + 0.04, 0.12, w.maxZ - w.minZ + 0.04);
      m.setPosition((w.minX + w.maxX) / 2, w.maxY - 0.05, (w.minZ + w.maxZ) / 2);
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [walls]);
  const mat = toon(color, {}, `top${color}`);
  return <instancedMesh ref={ref} args={[unit, mat, walls.length]} frustumCulled={false} />;
}

/** One InstancedMesh per static wall kind. Remount with a key when the wall list changes. */
export default function StaticWalls({ walls }: { walls: WallBox[] }) {
  const groups = useMemo(() => {
    const by = new Map<WallKind, WallBox[]>();
    for (const w of walls) {
      if (!w.isStatic || w.kind === 'invisible') continue;
      let l = by.get(w.kind);
      if (!l) { l = []; by.set(w.kind, l); }
      l.push(w);
    }
    return [...by.entries()];
  }, [walls]);
  return (
    <>
      {groups.map(([kind, list]) => <Group key={kind} kind={kind} walls={list} />)}
    </>
  );
}
