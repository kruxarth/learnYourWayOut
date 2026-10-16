import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Color, PlaneGeometry, type Mesh } from 'three';
import { engine } from '../game/engine';
import { slimeY } from '../game/loop/progression';
import { PAL, toon } from './materials';

const SIZE = 220, SEG = 64;

/** The rising slime: a big wobbly plane that follows the player in XZ. Animated on the CPU at ~30 Hz. */
export default function Slime() {
  const ref = useRef<Mesh>(null);
  const geo = useMemo(() => new PlaneGeometry(SIZE, SIZE, SEG, SEG), []);
  const last = useRef(0);
  const wasFrozen = useRef<boolean | null>(null); // the material is shared: set it on the first frame
  const mat = useMemo(() => toon(PAL.slime, {
    transparent: true, opacity: 0.82, emissive: new Color('#2E8B00'), emissiveIntensity: 0.25, depthWrite: false,
  }, 'slime'), []);
  useFrame(({ clock }) => {
    const m = ref.current, run = engine.run;
    if (!m || !run) return;
    const frozen = run.freezeT > 0;
    if (frozen !== wasFrozen.current) {
      wasFrozen.current = frozen;
      mat.color.set(frozen ? '#A8E6FF' : PAL.slime);
      mat.emissive.set(frozen ? '#3AA0D8' : '#2E8B00');
    }
    const p = engine.player.pos;
    // snap to a 2 m grid so the waves stay put in world space while the plane follows
    const cx = Math.round(p.x / 2) * 2, cz = Math.round(p.z / 2) * 2;
    m.position.set(cx, slimeY(run.slime), cz);
    const t = clock.elapsedTime;
    if (t - last.current < 1 / 30) return;
    last.current = t;
    const pos = geo.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const wx = cx + pos.getX(i), wz = cz - pos.getY(i);
      pos.setZ(i, Math.sin(wx * 0.35 + t * 1.6) * 0.08 + Math.sin(wz * 0.27 - t * 1.3) * 0.08);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
  });
  return <mesh ref={ref} geometry={geo} material={mat} rotation={[-Math.PI / 2, 0, 0]} renderOrder={3} />;
}
