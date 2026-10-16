import { useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { engine } from '../game/engine';
import { G } from '../game/state';

/** The only component that advances the simulation. */
export default function GameDriver() {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    if (G.debug) (window as unknown as { __lywo?: Record<string, unknown> }).__lywo!.gl = gl;
  }, [gl]);
  useFrame((_, dt) => engine.update(Math.min(dt, 0.1)), -1);
  return null;
}
