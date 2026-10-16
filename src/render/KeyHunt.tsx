import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Color, Group, MeshBasicMaterial, MeshToonMaterial, type Mesh } from 'three';
import { engine } from '../game/engine';
import type { KeyRT, RoomRuntime } from '../game/runtime';
import { labelTexture } from './labels';
import { PAL, toonGradient } from './materials';
import { withVisibility } from './visibility';

/** A golden key with its answer floating above it. Carried keys follow the bean; crossed-out keys turn red. */
function KeyMesh({ get }: { get: () => KeyRT | null }) {
  const root = useRef<Group>(null);
  const label = useRef<Mesh>(null);
  const lastKey = useRef('');
  const camera = useThree((s) => s.camera);
  const mats = useMemo(() => ({
    gold: withVisibility(new MeshToonMaterial({ color: new Color(PAL.gold), gradientMap: toonGradient(), transparent: true, emissive: new Color(PAL.gold), emissiveIntensity: 0.35 })),
    label: withVisibility(new MeshBasicMaterial({ transparent: true, depthTest: false })),
  }), []);
  useEffect(() => () => { mats.gold.dispose(); mats.label.dispose(); }, [mats]);

  useFrame(({ clock }) => {
    const r = root.current, l = label.current;
    const k = get();
    if (!r || !l) return;
    if (!k || k.state === 'used') { r.visible = false; return; }
    r.visible = true;
    const t = clock.elapsedTime;
    if (k.state === 'carried') {
      const p = engine.player.pos;
      r.position.set(p.x, p.y + 2.1 + Math.sin(t * 5) * 0.08, p.z);
    } else {
      r.position.set(k.home.x, 0.9 + Math.sin(t * 2) * 0.1, k.home.z);
    }
    r.rotation.y = t * 1.6;
    const bad = k.state === 'wrong';
    mats.gold.color.set(bad ? PAL.bad : PAL.gold);
    mats.gold.emissive.set(bad ? PAL.bad : PAL.gold);
    mats.gold.emissiveIntensity = bad ? 0.2 : 0.35;
    const text = bad ? `✗ ${k.label}` : k.label;
    if (text !== lastKey.current) {
      lastKey.current = text;
      mats.label.map = labelTexture(bad
        ? { text, bg: '#FFE3E7', fg: PAL.bad, border: PAL.bad }
        : { text, bg: '#FFFFFF', fg: PAL.uiText, border: PAL.panelBorder });
      mats.label.needsUpdate = true;
    }
    // billboard the label against the key's own spin
    l.quaternion.copy(camera.quaternion);
    l.quaternion.premultiply(r.quaternion.clone().invert());
  });

  return (
    <group ref={root} visible={false}>
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0.45, 0]} material={mats.gold} castShadow><torusGeometry args={[0.32, 0.1, 10, 20]} /></mesh>
      <mesh position={[0, -0.15, 0]} material={mats.gold} castShadow><boxGeometry args={[0.14, 0.9, 0.14]} /></mesh>
      <mesh position={[0.16, -0.4, 0]} material={mats.gold}><boxGeometry args={[0.28, 0.12, 0.14]} /></mesh>
      <mesh position={[0.14, -0.2, 0]} material={mats.gold}><boxGeometry args={[0.24, 0.12, 0.14]} /></mesh>
      <mesh ref={label} position={[0, 1.5, 0]} material={mats.label} renderOrder={5}><planeGeometry args={[2.6, 1.3]} /></mesh>
    </group>
  );
}

const MAX_KEYS = 4;

export default function KeyHuntView({ room }: { room: RoomRuntime }) {
  return (
    <group>
      {Array.from({ length: MAX_KEYS }, (_, i) => <KeyMesh key={i} get={() => room.keys[i] ?? null} />)}
    </group>
  );
}
