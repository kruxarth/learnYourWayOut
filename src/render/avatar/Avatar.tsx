import { useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { CapsuleGeometry, Color, SphereGeometry, type Group } from 'three';
import type { AvatarConfig } from '../../game/avatar';
import { BODY_COLORS } from '../../game/palette';
import { useUI } from '../../ui/store';
import { toon } from '../materials';
import { Extra } from './parts/Extras';
import { Eyes, Mouth } from './parts/Faces';
import { Hat } from './parts/Hats';
import { MAX_LEAN, makePose, type AvatarPose } from './pose';

export type { AvatarPose } from './pose';

// Shared geometry: base meshes are the body capsule plus two feet (3 of the 14-mesh budget).
const bodyGeo = new CapsuleGeometry(0.45, 0.7, 6, 16);
const footGeo = new SphereGeometry(0.17, 10, 8);

const shades = new Map<string, string>();
/** A darker copy of a colour, for the feet. */
function darker(hex: string): string {
  let s = shades.get(hex);
  if (!s) {
    const c = new Color(hex);
    const hsl = { h: 0, s: 0, l: 0 };
    c.getHSL(hsl);
    c.setHSL(hsl.h, hsl.s, hsl.l * 0.72);
    s = `#${c.getHexString()}`;
    shades.set(hex, s);
  }
  return s;
}

/**
 * The player character: presentational only. It reads `pose` every frame and owns no physics.
 * Origin is at the feet, the face looks toward -Z.
 */
export default function Avatar({ config, pose }: { config: AvatarConfig; pose: AvatarPose }) {
  const body = useRef<Group>(null);
  const eyes = useRef<Group>(null);
  const footL = useRef<Group>(null);
  const footR = useRef<Group>(null);
  const color = BODY_COLORS[config.body];

  useFrame(({ clock }) => {
    const b = body.current;
    if (!b) return;
    const reduced = useUI.getState().settings.reducedMotion;
    const bob = reduced ? 0 : Math.sin(clock.elapsedTime * 2.4) * 0.018 * (1 - Math.min(1, pose.lean / MAX_LEAN));
    const s = pose.squash;
    b.scale.set(1 - s / 2, 1 + s + bob, 1 - s / 2);
    b.rotation.x = -pose.lean + pose.spinAngle * pose.spinAxisX;
    b.rotation.z = (reduced ? 0 : pose.waddle) + pose.spinAngle * pose.spinAxisZ;
    if (eyes.current) eyes.current.scale.y = pose.blink;
    const stride = reduced ? 0 : Math.min(1, pose.lean / MAX_LEAN);
    const ph = pose.footPhase;
    if (footL.current) { footL.current.position.z = Math.sin(ph) * 0.2 * stride; footL.current.position.y = Math.max(0, Math.cos(ph)) * 0.1 * stride; }
    if (footR.current) { footR.current.position.z = Math.sin(ph + Math.PI) * 0.2 * stride; footR.current.position.y = Math.max(0, Math.cos(ph + Math.PI)) * 0.1 * stride; }
  });

  const foot = toon(darker(color));
  return (
    <group ref={body}>
      <mesh position={[0, 0.8, 0]} castShadow geometry={bodyGeo} material={toon(color)} />
      <group ref={footL} position={[-0.2, 0.13, -0.05]}><mesh geometry={footGeo} scale={[1, 0.7, 1.25]} material={foot} /></group>
      <group ref={footR} position={[0.2, 0.13, -0.05]}><mesh geometry={footGeo} scale={[1, 0.7, 1.25]} material={foot} /></group>
      <Eyes id={config.eyes} groupRef={eyes} />
      <Mouth id={config.mouth} />
      <Hat id={config.hat} />
      <Extra id={config.extra} pose={pose} />
    </group>
  );
}

/** A still avatar in its own small Canvas (results card, lobby). For long grids use one shared Canvas instead. */
export function AvatarThumb({ config, size = 72, spin = false }: { config: AvatarConfig; size?: number; spin?: boolean }) {
  const pose = useMemo(() => makePose(), []);
  return (
    <div style={{ width: size, height: size }} aria-hidden="true">
      <Canvas frameloop={spin ? 'always' : 'demand'} dpr={[1, 2]} flat camera={{ fov: 30, position: [0, 1.3, 6.2], near: 0.1, far: 30 }}>
        <hemisphereLight args={['#CFEFFF', '#FFE2C4', 1.6]} />
        <directionalLight position={[3, 5, 4]} intensity={2.2} />
        <Spinner spin={spin}><Avatar config={config} pose={pose} /></Spinner>
      </Canvas>
    </div>
  );
}

/** Turns its children slowly about Y; also used by the wardrobe preview. */
export function Spinner({ spin = true, y = -0.1, children }: { spin?: boolean; y?: number; children: React.ReactNode }) {
  const g = useRef<Group>(null);
  useFrame((_, dt) => { if (g.current && spin) g.current.rotation.y += Math.min(dt, 0.05) * 0.8; });
  // the avatar looks toward -Z; start turned a little toward the camera's right so the face reads
  return <group ref={g} position={[0, y, 0]} rotation={[0, Math.PI - 0.5, 0]}>{children}</group>;
}
