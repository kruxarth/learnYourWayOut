import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Vector3 } from 'three';
import { engine } from '../game/engine';
import { T } from '../game/tuning';
import { useUI } from '../ui/store';

/** Third-person follow camera (spec §7.3, §8.8). Writes the R3F camera. */
export default function CameraRig() {
  const camera = useThree((s) => s.camera);
  const snap = useRef(-1);
  const target = useRef(new Vector3());
  const desired = useRef(new Vector3());
  const shakeNow = useRef(0);

  useEffect(() => {
    const off = engine.events.on((e) => {
      const reduced = useUI.getState().settings.reducedMotion;
      if (reduced) return;
      const c = engine.camera;
      if (e.type === 'answer') c.shake = Math.max(c.shake, e.correct ? 0.15 : 0.4);
      else if (e.type === 'bounce') c.shake = Math.max(c.shake, 0.6);
      else if (e.type === 'land' && e.impact > 12) c.shake = Math.max(c.shake, 0.2);
      else if (e.type === 'doorWrong') c.shake = Math.max(c.shake, 0.4);
      else if (e.type === 'doorBurst') c.shake = Math.max(c.shake, 0.15);
    });
    return () => { off(); };
  }, []);

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.1);
    const p = engine.player, cs = engine.camera;
    const t = target.current, d = desired.current;
    t.set(p.pos.x, p.pos.y + T.CAM_TARGET_Y, p.pos.z);
    d.set(t.x + Math.sin(cs.yaw) * T.CAM_DIST, t.y + T.CAM_HEIGHT, t.z + Math.cos(cs.yaw) * T.CAM_DIST);
    if (snap.current !== cs.snapVersion) {
      camera.position.copy(d);
      snap.current = cs.snapVersion;
    } else {
      const k = 1 - Math.exp(-T.CAM_LERP * dt);
      camera.position.lerp(d, k);
    }
    shakeNow.current = cs.shake;
    if (cs.shake > 0.001) {
      camera.position.x += (Math.random() - 0.5) * cs.shake;
      camera.position.y += (Math.random() - 0.5) * cs.shake;
      camera.position.z += (Math.random() - 0.5) * cs.shake;
      cs.shake *= Math.exp(-6 * dt);
    } else cs.shake = 0;
    camera.lookAt(t);
  });
  return null;
}
