import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Color, Group, MeshBasicMaterial, MeshToonMaterial, type Mesh } from 'three';
import type { RoomRuntime, RunState, TileRT } from '../game/runtime';
import { labelTexture } from './labels';
import { PAL, toonGradient } from './materials';
import { withVisibility } from './visibility';

const THICK = 0.4;
const GAP = 0.2;
const SUNK_Y = -0.55;

/** One tile: a fitting tile locks green; a wrong one shakes, falls and comes back as a sunken red X. */
function MineTile({ get }: { get: () => TileRT | null }) {
  const root = useRef<Group>(null);
  const box = useRef<Mesh>(null);
  const label = useRef<Mesh>(null);
  const lastKey = useRef('');
  const mats = useMemo(() => ({
    box: withVisibility(new MeshToonMaterial({ color: new Color(PAL.tile), gradientMap: toonGradient(), transparent: true })),
    label: withVisibility(new MeshBasicMaterial({ transparent: true })),
  }), []);
  useEffect(() => () => { mats.box.dispose(); mats.label.dispose(); }, [mats]);

  useFrame(({ clock }) => {
    const r = root.current, b = box.current, l = label.current;
    if (!r || !b || !l) return;
    const t = get();
    if (!t || !t.visible) { r.visible = false; return; }
    const sunk = t.state === 'gone';
    if (sunk && !t.marked) { r.visible = false; return; }
    r.visible = true;
    let ox = 0, oy = 0, oz = 0, op = 1;
    if (t.state === 'shaking') { ox = (Math.random() - 0.5) * 0.14; oz = (Math.random() - 0.5) * 0.14; }
    else if (t.state === 'falling') { oy = -12 * t.t * t.t; op = Math.max(0, 1 - t.t / 1.2); }
    else if (sunk) { oy = SUNK_Y; op = 0.9; }
    r.position.set(t.cx + ox, oy, t.cz + oz);
    b.scale.set(Math.max(0.1, t.sx - GAP * 2), THICK, Math.max(0.1, t.sz - GAP * 2));
    b.position.y = -THICK / 2;
    mats.box.opacity = op; mats.label.opacity = op;
    if (sunk) { mats.box.color.set('#F26B7F'); mats.box.emissive.set(PAL.bad); mats.box.emissiveIntensity = 0.3; }
    else if (t.state === 'locked') { mats.box.color.set(PAL.tile); mats.box.emissive.set(PAL.good); mats.box.emissiveIntensity = 0.55; }
    else if (t.state === 'shaking') { mats.box.color.set(PAL.tile); mats.box.emissive.set(PAL.bad); mats.box.emissiveIntensity = 0.45 + 0.2 * Math.sin(clock.elapsedTime * 40); }
    else { mats.box.color.set(PAL.tile); mats.box.emissiveIntensity = 0; }
    const text = sunk ? `✗ ${t.label}` : t.label;
    const key = `${text}|${sunk ? 'x' : t.state === 'locked' ? 'ok' : 'n'}`;
    if (key !== lastKey.current) {
      lastKey.current = key;
      mats.label.map = sunk
        ? labelTexture({ text, bg: '#FFE3E7', fg: PAL.bad, border: PAL.bad })
        : t.state === 'locked'
          ? labelTexture({ text, bg: '#D8FFE6', fg: '#16794A', border: PAL.good })
          : labelTexture({ text, bg: '#FFFFFF', fg: PAL.uiText, border: PAL.panelBorder });
      mats.label.needsUpdate = true;
    }
    const lw = Math.max(0.5, Math.min(t.sx - 0.8, (t.sz - 0.6) * 2));
    l.scale.set(lw, lw / 2, 1);
    l.position.y = 0.012;
  });

  return (
    <group ref={root}>
      <mesh ref={box} material={mats.box} receiveShadow castShadow><boxGeometry args={[1, 1, 1]} /></mesh>
      <mesh ref={label} rotation={[-Math.PI / 2, 0, 0]} material={mats.label}><planeGeometry args={[1, 1]} /></mesh>
    </group>
  );
}

export default function RuleMinefieldView({ room }: { room: RoomRuntime; run?: RunState }) {
  return (
    <group>
      {room.stepRows.map((row, ri) => row.map((_, si) => (
        <MineTile key={`${room.id}:m${ri}:${si}`} get={() => room.stepRows[ri][si] ?? null} />
      )))}
    </group>
  );
}
