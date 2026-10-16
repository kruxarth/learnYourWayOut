import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { PerspectiveCamera, Vector3 } from 'three';
import { engine } from '../game/engine';
import { T } from '../game/tuning';
import { inMazeSegment } from '../game/loop/visibility';
import { useUI } from '../ui/store';

/** Third-person follow camera (spec §7.3, §8.8). Writes the R3F camera. */
export default function CameraRig() {
  const camera = useThree((s) => s.camera);
  const snap = useRef(-1);
  const target = useRef(new Vector3());
  const desired = useRef(new Vector3());
  const shakeNow = useRef(0);
  const chase = useRef(0);

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
    const run = engine.mode === 'run' ? engine.run : null;
    const want = run && inMazeSegment(run) ? 1 : 0;
    const snapNow = snap.current !== cs.snapVersion;
    chase.current = snapNow ? want : chase.current + (want - chase.current) * (1 - Math.exp(-T.CHASE_EASE * dt));
    const k0 = chase.current;
    const dist = T.CAM_DIST + (T.CHASE_DIST - T.CAM_DIST) * k0;
    const height = T.CAM_HEIGHT + (T.CHASE_HEIGHT - T.CAM_HEIGHT) * k0;
    const ty = T.CAM_TARGET_Y + (T.CHASE_TARGET_Y - T.CAM_TARGET_Y) * k0;
    const fov = T.CAM_FOV + (T.CHASE_FOV - T.CAM_FOV) * k0;
    if (camera instanceof PerspectiveCamera && Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
    t.set(p.pos.x, p.pos.y + ty, p.pos.z);
    d.set(t.x + Math.sin(cs.yaw) * dist, t.y + height, t.z + Math.cos(cs.yaw) * dist);
    if (snapNow) {
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
