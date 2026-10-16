import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Color, DoubleSide, Group, RingGeometry, type Mesh } from 'three';
import type { HubBooth, HubPad, HubPortal, HubState } from '../game/loop/selection';
import { T } from '../game/tuning';
import { bestTimeFor, formatTime } from '../game/persistence';
import { labelTexture, signTexture } from './labels';
import { PAL, toon } from './materials';

function PortalMesh({ portal }: { portal: HubPortal }) {
  const disc = useRef<Mesh>(null);
  const label = useRef<Mesh>(null);
  const camera = useThree((s) => s.camera);
  const tex = useMemo(() => {
    const best = bestTimeFor(portal.domainId);
    const sub = portal.domainId === 'custom' ? 'Type your own!' : best === null ? '' : `Best: ${formatTime(best)}`;
    return signTexture(portal.name, sub, '#FFFFFF', portal.color);
  }, [portal]);
  const yaw = Math.atan2(-portal.x, -portal.z);
  useFrame(({ clock }) => {
    if (disc.current) disc.current.rotation.z = clock.elapsedTime * 1.8;
    if (label.current) label.current.quaternion.copy(camera.quaternion);
  });
  return (
    <group position={[portal.x, 0, portal.z]}>
      <group position={[0, 2.5, 0]} rotation={[0, yaw, 0]}>
        <mesh material={toon(portal.color, { emissive: new Color(portal.color), emissiveIntensity: 0.3 }, `hubportal${portal.color}`)} castShadow>
          <torusGeometry args={[2.2, 0.35, 14, 40]} />
        </mesh>
        <mesh ref={disc}>
          <circleGeometry args={[1.95, 28, 0, Math.PI * 1.75]} />
          <meshBasicMaterial color={portal.color} transparent opacity={0.5} side={DoubleSide} />
        </mesh>
      </group>
      {/* low, in front of the ring, so it is in view from the spawn rather than above the top of the screen */}
      <mesh ref={label} position={[-1.6 * Math.sin(portal.angle), 1.3, 1.6 * Math.cos(portal.angle)]}>
        <planeGeometry args={[4.4, 2.2]} />
        <meshBasicMaterial map={tex} transparent />
      </mesh>
    </group>
  );
}

function PadMesh({ pad, hub }: { pad: HubPad; hub: HubState }) {
  const ring = useRef<Mesh>(null);
  const lastStep = useRef(-1);
  const tex = useMemo(() => labelTexture({ text: pad.difficulty.toUpperCase(), w: 256, h: 128, maxLines: 1, border: pad.color }), [pad]);
  useEffect(() => () => { ring.current?.geometry.dispose(); }, []);
  useFrame(() => {
    const r = ring.current;
    if (!r) return;
    const active = hub.activePad === pad;
    const step = active ? Math.max(0, Math.min(32, Math.floor((hub.hold / T.PAD_HOLD_TIME) * 32))) : 0;
    if (step !== lastStep.current) {
      lastStep.current = step;
      r.geometry.dispose();
      r.geometry = new RingGeometry(1.2, 1.45, 36, 1, Math.PI / 2, (step / 32) * Math.PI * 2 || 0.0001);
      r.visible = step > 0;
    }
  });
  return (
    <group position={[pad.x, 0, pad.z]}>
      <mesh position={[0, 0.05, 0]} material={toon(pad.color, {}, `pad${pad.color}`)} receiveShadow>
        <cylinderGeometry args={[T.PAD_RADIUS, T.PAD_RADIUS, 0.1, 32]} />
      </mesh>
      <mesh position={[0, 0.112, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[1.5, 0.75]} />
        <meshBasicMaterial map={tex} transparent />
      </mesh>
      <mesh ref={ring} position={[0, 0.13, 0]} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
        <ringGeometry args={[1.2, 1.45, 36, 1, 0, 0.001]} />
        <meshBasicMaterial color={PAL.uiAccent} side={DoubleSide} />
      </mesh>
    </group>
  );
}

/** A utility booth (Wardrobe): a coloured pad with a floating sign. Standing on it opens the panel. */
function BoothMesh({ booth }: { booth: HubBooth }) {
  const sign = useRef<Mesh>(null);
  const camera = useThree((s) => s.camera);
  const tex = useMemo(() => signTexture(booth.label === 'WARDROBE' ? 'Wardrobe' : booth.label, 'Stand here', '#FFFFFF', booth.color), [booth]);
  useFrame(() => { if (sign.current) sign.current.quaternion.copy(camera.quaternion); });
  return (
    <group position={[booth.x, 0, booth.z]}>
      <mesh position={[0, 0.05, 0]} material={toon(booth.color, {}, `booth${booth.color}`)} receiveShadow>
        <cylinderGeometry args={[T.PAD_RADIUS * 1.3, T.PAD_RADIUS * 1.3, 0.1, 32]} />
      </mesh>
      <mesh position={[0, 0.11, 0]} material={toon('#FFFFFF', {}, 'boothInner')}>
        <cylinderGeometry args={[T.PAD_RADIUS * 0.8, T.PAD_RADIUS * 0.8, 0.1, 32]} />
      </mesh>
      <mesh ref={sign} position={[0, 3.2, 0]}>
        <planeGeometry args={[3.2, 1.6]} />
        <meshBasicMaterial map={tex} transparent />
      </mesh>
    </group>
  );
}

function Tree({ x, z, s }: { x: number; z: number; s: number }) {
  return (
    <group position={[x, 0, z]} scale={s}>
      <mesh position={[0, 0.8, 0]} material={toon('#A9743D', {}, 'trunk')} castShadow><cylinderGeometry args={[0.28, 0.36, 1.6, 8]} /></mesh>
      <mesh position={[0, 2.9, 0]} material={toon(PAL.hedge, {}, 'tree')} castShadow><coneGeometry args={[1.5, 3.2, 9]} /></mesh>
      <mesh position={[0, 4.4, 0]} material={toon(PAL.hedgeTop, {}, 'treeTop')} castShadow><coneGeometry args={[1.0, 2.2, 9]} /></mesh>
    </group>
  );
}

export default function HubScene({ hub }: { hub: HubState }) {
  const root = useRef<Group>(null);
  const hint = useMemo(() => labelTexture({ text: 'Walk onto a pad to start', w: 1024, h: 256, maxLines: 1, border: PAL.uiAccent }), []);
  return (
    <group ref={root}>
      <mesh position={[0, -0.6, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[800, 800]} />
        <meshBasicMaterial color={PAL.water} />
      </mesh>
      <mesh position={[0, -0.2, 0]} material={toon(PAL.floorMaze, {}, 'hubfloor')} receiveShadow>
        <cylinderGeometry args={[22, 22, 0.4, 56]} />
      </mesh>
      <mesh position={[0, -0.28, 0]} material={toon('#E7C98F', {}, 'hubrim')}>
        <cylinderGeometry args={[22.8, 22.8, 0.4, 56]} />
      </mesh>
      {hub.portals.map((p) => <PortalMesh key={p.domainId} portal={p} />)}
      {hub.pads.map((p) => <PadMesh key={`${p.domainId}:${p.difficulty}`} pad={p} hub={hub} />)}
      {hub.booths.map((b) => <BoothMesh key={b.id} booth={b} />)}
      {hub.trees.map((t, i) => <Tree key={i} {...t} />)}
      <mesh position={[0, 0.03, 8]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[9, 2.25]} />
        <meshBasicMaterial map={hint} transparent />
      </mesh>
    </group>
  );
}

