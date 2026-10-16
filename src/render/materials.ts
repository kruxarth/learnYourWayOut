import {
  Color, DataTexture, MeshToonMaterial, NearestFilter, RedFormat, UnsignedByteType,
  type MeshToonMaterialParameters,
} from 'three';

import { withVisibility } from './visibility';

export { PAL } from '../game/palette';

let gradient: DataTexture | null = null;
export function toonGradient(): DataTexture {
  if (!gradient) {
    gradient = new DataTexture(new Uint8Array([90, 170, 255]), 3, 1, RedFormat, UnsignedByteType);
    gradient.minFilter = NearestFilter;
    gradient.magFilter = NearestFilter;
    gradient.generateMipmaps = false;
    gradient.needsUpdate = true;
  }
  return gradient;
}

const cache = new Map<string, MeshToonMaterial>();

/** Shared toon material (created once per distinct option set). Fades with the visibility radius unless `fade` is false. */
export function toon(color: string, opts: MeshToonMaterialParameters = {}, key = '', fade = true): MeshToonMaterial {
  const k = `${color}|${key}`;
  let m = cache.get(k);
  if (!m) {
    m = new MeshToonMaterial({ color: new Color(color), gradientMap: toonGradient(), ...opts });
    if (fade) withVisibility(m);
    cache.set(k, m);
  }
  return m;
}

/** Slightly vary a base color's lightness (for per-instance hedge variety). */
export function tint(base: string, amount: number, out = new Color()): Color {
  out.set(base);
  const hsl = { h: 0, s: 0, l: 0 };
  out.getHSL(hsl);
  out.setHSL(hsl.h, hsl.s, Math.min(1, Math.max(0, hsl.l * (1 + amount))));
  return out;
}
