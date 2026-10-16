import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Color, DoubleSide, Matrix4, Object3D, type InstancedMesh } from 'three';
import { engine } from '../game/engine';
import { useUI } from '../ui/store';
import { PAL } from './materials';

const N = 200;
const COLORS = [PAL.bean, PAL.gold, PAL.good, '#4F8BFF', '#B05CFF', '#FF9F43'];

/** Pooled confetti pieces: spawn on correct answers, bridge completion and the win. */
export default function Confetti() {
  const ref = useRef<InstancedMesh>(null);
  const data = useMemo(() => ({
    pos: new Float32Array(N * 3), vel: new Float32Array(N * 3), spin: new Float32Array(N * 3), rot: new Float32Array(N * 3),
    life: new Float32Array(N), next: 0,
  }), []);
  const dummy = useMemo(() => new Object3D(), []);

  useEffect(() => {
    const burst = (x: number, y: number, z: number, count: number) => {
      const reduced = useUI.getState().settings.reducedMotion;
      const c = reduced ? Math.ceil(count * 0.25) : count;
      const mesh = ref.current;
      for (let i = 0; i < c; i++) {
        const k = data.next; data.next = (data.next + 1) % N;
        const a = Math.random() * Math.PI * 2, sp = 6 + Math.random() * 4, cone = 0.35 + Math.random() * 0.5;
        data.pos[k * 3] = x; data.pos[k * 3 + 1] = y; data.pos[k * 3 + 2] = z;
        data.vel[k * 3] = Math.cos(a) * sp * cone; data.vel[k * 3 + 1] = sp * (0.7 + Math.random() * 0.5); data.vel[k * 3 + 2] = Math.sin(a) * sp * cone;
        data.spin[k * 3] = (Math.random() - 0.5) * 14; data.spin[k * 3 + 1] = (Math.random() - 0.5) * 14; data.spin[k * 3 + 2] = (Math.random() - 0.5) * 14;
        data.life[k] = 1.8;
        mesh?.setColorAt(k, new Color(COLORS[(Math.random() * COLORS.length) | 0]));
      }
      if (mesh?.instanceColor) mesh.instanceColor.needsUpdate = true;
    };
    const off = engine.events.on((e) => {
      if (e.type === 'answer' && e.correct) burst(e.x, e.y, e.z, 60);
      else if (e.type === 'bridgeComplete') { const p = engine.player.pos; burst(p.x, p.y + 2, p.z, 100); }
      else if (e.type === 'win') { const p = engine.player.pos; burst(p.x, p.y + 1.5, p.z, 200); }
    });
    return () => { off(); };
  }, [data]);

  useFrame((_, dtRaw) => {
    const mesh = ref.current;
    if (!mesh) return;
    const dt = Math.min(dtRaw, 0.05);
    const drag = Math.pow(0.98, dt * 120);
    const m = new Matrix4();
    for (let i = 0; i < N; i++) {
      if (data.life[i] <= 0) { dummy.scale.setScalar(0); dummy.position.set(0, -999, 0); dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix); continue; }
      data.life[i] -= dt;
      data.vel[i * 3 + 1] -= 15 * dt;
      for (let a = 0; a < 3; a++) { data.vel[i * 3 + a] *= drag; data.pos[i * 3 + a] += data.vel[i * 3 + a] * dt; data.rot[i * 3 + a] += data.spin[i * 3 + a] * dt; }
      dummy.position.set(data.pos[i * 3], data.pos[i * 3 + 1], data.pos[i * 3 + 2]);
      dummy.rotation.set(data.rot[i * 3], data.rot[i * 3 + 1], data.rot[i * 3 + 2]);
      dummy.scale.setScalar(Math.min(1, data.life[i] * 2));
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    void m;
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, N]} frustumCulled={false}>
      <planeGeometry args={[0.12, 0.2]} />
      <meshBasicMaterial side={DoubleSide} fog={false} />
    </instancedMesh>
  );
}
