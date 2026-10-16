import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { BackSide, BufferAttribute, Color, SphereGeometry, type Mesh } from 'three';
import { PAL } from './materials';

export default function Sky() {
  const ref = useRef<Mesh>(null);
  const geo = useMemo(() => {
    const g = new SphereGeometry(250, 32, 16);
    const pos = g.getAttribute('position');
    const colors = new Float32Array(pos.count * 3);
    const top = new Color(PAL.skyTop), hor = new Color(PAL.skyHorizon), c = new Color();
    for (let i = 0; i < pos.count; i++) {
      const t = Math.min(1, Math.max(0, (pos.getY(i) / 250) * 1.4 + 0.15));
      c.copy(hor).lerp(top, t);
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new BufferAttribute(colors, 3));
    return g;
  }, []);
  useFrame(({ camera }) => {
    if (ref.current) ref.current.position.copy(camera.position);
  });
  return (
    <mesh ref={ref} geometry={geo} renderOrder={-10} frustumCulled={false}>
      <meshBasicMaterial vertexColors side={BackSide} fog={false} depthWrite={false} />
    </mesh>
  );
}
