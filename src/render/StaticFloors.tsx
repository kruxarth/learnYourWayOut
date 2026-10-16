import { useLayoutEffect, useMemo, useRef } from 'react';
import { BoxGeometry, Color, Matrix4, type InstancedMesh } from 'three';
import type { FloorRect } from '../game/types';
import { toon } from './materials';

const unit = new BoxGeometry(1, 1, 1);
export const FLOOR_THICK = 0.4;

export default function StaticFloors({ floors }: { floors: FloorRect[] }) {
  const list = useMemo(() => floors.filter((f) => f.isStatic), [floors]);
  const ref = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new Matrix4();
    const c = new Color();
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      m.makeScale(f.maxX - f.minX, FLOOR_THICK, f.maxZ - f.minZ);
      m.setPosition((f.minX + f.maxX) / 2, f.top - FLOOR_THICK / 2, (f.minZ + f.maxZ) / 2);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, c.set(f.color));
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [list]);
  const mat = toon('#ffffff', {}, 'white');
  return <instancedMesh ref={ref} args={[unit, mat, list.length]} receiveShadow frustumCulled={false} />;
}
