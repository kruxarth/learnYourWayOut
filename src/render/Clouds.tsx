import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Group } from 'three';
import { mulberry32 } from '../game/rng';
import { toon } from './materials';

const cloudMat = toon('#FFFFFF', { fog: false }, 'cloud', false);

/** 12 clusters of white toon spheres that drift slowly around the camera (P1). */
export default function Clouds() {
  const root = useRef<Group>(null);
  const clusters = useMemo(() => {
    const rng = mulberry32(99);
    return Array.from({ length: 12 }, (_, i) => {
      const a = (i / 12) * Math.PI * 2 + rng() * 0.4;
      const r = 160 + rng() * 40;
      const puffs = Array.from({ length: 4 + Math.floor(rng() * 3) }, () => ({
        x: (rng() - 0.5) * 14, y: (rng() - 0.5) * 3, z: (rng() - 0.5) * 8, s: 4 + rng() * 4,
      }));
      return { x: Math.cos(a) * r, y: 40 + rng() * 30, z: Math.sin(a) * r, puffs };
    });
  }, []);
  useFrame(({ camera, clock }) => {
    const g = root.current;
    if (!g) return;
    g.position.set(camera.position.x, 0, camera.position.z);
    g.rotation.y = clock.elapsedTime * 0.004;
  });
  return (
    <group ref={root}>
      {clusters.map((c, i) => (
        <group key={i} position={[c.x, c.y, c.z]}>
          {c.puffs.map((p, j) => (
            <mesh key={j} position={[p.x, p.y, p.z]} scale={[p.s, p.s * 0.7, p.s]} material={cloudMat}>
              <sphereGeometry args={[1, 10, 8]} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}
