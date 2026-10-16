import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { BoxGeometry, ConeGeometry, SphereGeometry, TorusGeometry, type Group } from 'three';
import type { ExtraId } from '../../../game/avatar';
import { toon } from '../../materials';
import { merged, placed } from '../geo';
import type { AvatarPose } from '../pose';

// Max 2 meshes per extra. The body is a capsule of radius 0.45 around the Y axis; the face looks toward -Z.
const scarfRing = placed(new TorusGeometry(0.46, 0.09, 8, 20), [0, 0.74, 0], [Math.PI / 2, 0, 0]);
const scarfTail = placed(new BoxGeometry(0.16, 0.42, 0.07), [0.24, 0.5, -0.42], [0, 0, 0.12]);

const bowWings = merged([
  placed(new ConeGeometry(0.11, 0.2, 8), [-0.12, 0, 0], [0, 0, Math.PI / 2]),
  placed(new ConeGeometry(0.11, 0.2, 8), [0.12, 0, 0], [0, 0, -Math.PI / 2]),
]);
const bowKnot = placed(new SphereGeometry(0.055, 8, 6), [0, 0, 0]);

const bagBody = placed(new BoxGeometry(0.5, 0.6, 0.2), [0, 0.85, 0.52]);
const bagPocket = placed(new BoxGeometry(0.34, 0.24, 0.08), [0, 0.7, 0.66]);

const capeSheet = placed(new BoxGeometry(0.8, 0.95, 0.04), [0, -0.45, 0]);
const capeClasp = placed(new SphereGeometry(0.06, 8, 6), [0, 0, -0.02]);

const m = (c: string) => toon(c);

function Cape({ pose }: { pose: AvatarPose }) {
  const g = useRef<Group>(null);
  // flutters with how fast the avatar leans forward; render-only
  useFrame(() => { if (g.current) g.current.rotation.x = -(0.15 + pose.lean * 1.6); });
  return (
    <group ref={g} position={[0, 1.2, 0.44]}>
      <mesh geometry={capeSheet} material={m('#E8383D')} />
      <mesh geometry={capeClasp} material={m('#FFD23F')} position={[0, -0.2, -0.88]} />
    </group>
  );
}

export function Extra({ id, pose }: { id: ExtraId; pose: AvatarPose }) {
  switch (id) {
    case 'scarf': return (<><mesh geometry={scarfRing} material={m('#E8383D')} /><mesh geometry={scarfTail} material={m('#C02A30')} /></>);
    case 'bowtie': return (<group position={[0, 0.72, -0.43]}><mesh geometry={bowWings} material={m('#FF4FA0')} /><mesh geometry={bowKnot} material={m('#C93480')} /></group>);
    case 'bookbag': return (<><mesh geometry={bagBody} material={m('#3D5AFE')} /><mesh geometry={bagPocket} material={m('#2A3FB5')} /></>);
    case 'cape': return <Cape pose={pose} />;
    default: return null;
  }
}
