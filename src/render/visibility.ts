import { Vector3, type Material } from 'three';
import { T } from '../game/tuning';
import { PAL } from '../game/palette';

/**
 * Player-centred visibility (P0-B). Patched materials fade to the horizon colour between 0.6 R
 * and R metres from the player (XZ), so a maze can't be read from above. The uniforms are shared
 * by every patched material; `VisibilityDriver` (Scene) eases R and moves the centre each frame.
 */

function srgb(hex: string): Vector3 {
  const n = parseInt(hex.slice(1), 16);
  // gl_FragColor is already in output (sRGB) space where the fade is applied
  return new Vector3(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

export const visUniforms = {
  uVisPlayer: { value: new Vector3() },
  uVisR: { value: T.VIS_OPEN as number },
  uVisColor: { value: srgb(PAL.skyHorizon) },
};

/** Opacity for things that fade by distance in JS (junction signs): 1 inside 0.6 R, 0 beyond R. */
export function visOpacity(x: number, z: number): number {
  const p = visUniforms.uVisPlayer.value, r = visUniforms.uVisR.value;
  const d = Math.hypot(x - p.x, z - p.z), a = 0.6 * r;
  if (d <= a) return 1;
  if (d >= r) return 0;
  const t = (d - a) / (r - a);
  return 1 - t * t * (3 - 2 * t);
}

/** Patch a toon or basic material in place. Safe to call once per material. */
export function withVisibility<M extends Material>(m: M): M {
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, visUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vVisWorld;')
      .replace('#include <project_vertex>', `#include <project_vertex>
  vec4 visP = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    visP = instanceMatrix * visP;
  #endif
  vVisWorld = (modelMatrix * visP).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vVisWorld;\nuniform vec3 uVisPlayer;\nuniform float uVisR;\nuniform vec3 uVisColor;')
      .replace('#include <fog_fragment>', `#include <fog_fragment>
  float visK = smoothstep(uVisR * 0.6, uVisR, distance(vVisWorld.xz, uVisPlayer.xz));
  gl_FragColor.rgb = mix(gl_FragColor.rgb, uVisColor, visK);`);
  };
  m.customProgramCacheKey = () => 'lywo-vis';
  return m;
}
