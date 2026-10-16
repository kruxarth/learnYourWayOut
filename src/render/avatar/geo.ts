import { BufferGeometry, Euler, Matrix4, Quaternion, Vector3, MeshBasicMaterial, DoubleSide } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

type V3 = [number, number, number];

/** A transformed copy of a geometry (module-level use only; never call this per frame). */
export function placed(g: BufferGeometry, pos: V3 = [0, 0, 0], rot: V3 = [0, 0, 0], scale: V3 = [1, 1, 1]): BufferGeometry {
  const m = new Matrix4().compose(new Vector3(...pos), new Quaternion().setFromEuler(new Euler(...rot)), new Vector3(...scale));
  return g.clone().applyMatrix4(m);
}

/** Merge several geometries into one mesh (one draw call). */
export function merged(list: BufferGeometry[]): BufferGeometry {
  const g = mergeGeometries(list);
  if (!g) throw new Error('avatar geometry merge failed');
  return g;
}

const basics = new Map<string, MeshBasicMaterial>();
/** Unlit shared material for faces (flat shapes are double-sided so facing never matters). */
export function basic(color: string): MeshBasicMaterial {
  let m = basics.get(color);
  if (!m) { m = new MeshBasicMaterial({ color, side: DoubleSide }); basics.set(color, m); }
  return m;
}
