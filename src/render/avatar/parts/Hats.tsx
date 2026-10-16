import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  BoxGeometry, ConeGeometry, CylinderGeometry, SphereGeometry, TorusGeometry, type Group,
} from 'three';
import type { HatId } from '../../../game/avatar';
import { toon } from '../../materials';
import { basic, merged, placed } from '../geo';

// The head is a sphere of radius 0.45 centred at y = 1.15 (top at 1.6). Max 3 meshes per hat.
const TAU = Math.PI * 2;
const dome = (r: number, deg: number) => new SphereGeometry(r, 16, 8, 0, TAU, 0, (deg * Math.PI) / 180);

const capDome = placed(dome(0.48, 62), [0, 1.15, 0]);
const capBrim = placed(new CylinderGeometry(0.32, 0.32, 0.04, 14), [0, 1.4, -0.4], [0.2, 0, 0], [1, 1, 0.8]);

const beanieDome = placed(dome(0.5, 68), [0, 1.14, 0]);
const beanieCuff = placed(new TorusGeometry(0.45, 0.06, 6, 18), [0, 1.34, 0], [Math.PI / 2, 0, 0]);
const pom = placed(new SphereGeometry(0.12, 10, 8), [0, 1.72, 0]);

const propDome = placed(dome(0.48, 55), [0, 1.15, 0]);
const propStick = placed(new CylinderGeometry(0.02, 0.02, 0.18, 6), [0, 1.7, 0]);
const propBlades = merged([
  placed(new BoxGeometry(0.62, 0.02, 0.1), [0, 0, 0], [0, 0, 0]),
  placed(new BoxGeometry(0.62, 0.02, 0.1), [0, 0, 0], [0, Math.PI / 2, 0]),
]);

const gradBand = placed(new CylinderGeometry(0.4, 0.42, 0.18, 14), [0, 1.45, 0]);
const gradBoard = placed(new BoxGeometry(0.85, 0.05, 0.85), [0, 1.58, 0], [0, Math.PI / 4, 0]);
const gradTassel = merged([
  placed(new CylinderGeometry(0.012, 0.012, 0.3, 4), [0.3, 1.45, 0.3]),
  placed(new SphereGeometry(0.05, 6, 6), [0.3, 1.28, 0.3]),
]);

const crownBand = placed(new CylinderGeometry(0.3, 0.27, 0.16, 12), [0, 1.62, 0]);
const crownSpikes = merged([0, 1, 2, 3, 4].map((i) => {
  const a = (i / 5) * TAU;
  return placed(new ConeGeometry(0.07, 0.2, 5), [Math.sin(a) * 0.27, 1.8, -Math.cos(a) * 0.27]);
}));
const crownGem = placed(new SphereGeometry(0.05, 8, 6), [0, 1.62, -0.29]);

const laurelRing = placed(new TorusGeometry(0.4, 0.035, 6, 24), [0, 1.42, 0], [Math.PI / 2, 0, 0]);
const laurelLeaves = merged(Array.from({ length: 10 }, (_, i) => {
  const a = (i / 10) * TAU;
  return placed(new SphereGeometry(0.07, 6, 5), [Math.cos(a) * 0.4, 1.46, Math.sin(a) * 0.4], [0, -a, 0.5], [2, 0.45, 1]);
}));

const gogStrap = placed(new TorusGeometry(0.455, 0.035, 6, 24), [0, 1.38, 0], [Math.PI / 2, 0, 0]);
const gogFrames = merged([-0.17, 0.17].map((x) => placed(new CylinderGeometry(0.15, 0.15, 0.1, 12), [x, 1.38, -0.4], [Math.PI / 2, 0, 0])));
const gogLens = merged([-0.17, 0.17].map((x) => placed(new CylinderGeometry(0.115, 0.115, 0.12, 12), [x, 1.38, -0.4], [Math.PI / 2, 0, 0])));

const hpBand = placed(new TorusGeometry(0.5, 0.04, 6, 18, Math.PI), [0, 1.15, 0], [0, 0, 0]);
const hpCups = merged([-1, 1].map((s) => placed(new CylinderGeometry(0.17, 0.17, 0.12, 12), [s * 0.47, 1.15, 0], [0, 0, Math.PI / 2])));

const wizCone = placed(new ConeGeometry(0.34, 0.85, 12), [0, 1.98, 0.02], [-0.12, 0, 0]);
const wizBrim = placed(new CylinderGeometry(0.6, 0.6, 0.04, 18), [0, 1.52, 0]);
const wizBand = placed(new TorusGeometry(0.33, 0.04, 6, 16), [0, 1.58, 0], [Math.PI / 2, 0, 0]);

const flowerPetals = merged(Array.from({ length: 5 }, (_, i) => {
  const a = (i / 5) * TAU;
  return placed(new SphereGeometry(0.1, 8, 6), [Math.cos(a) * 0.14, 1.64, Math.sin(a) * 0.14], [0, 0, 0], [1, 0.5, 1]);
}));
const flowerHeart = placed(new SphereGeometry(0.075, 8, 6), [0, 1.67, 0]);

const chefBand = placed(new CylinderGeometry(0.34, 0.37, 0.28, 14), [0, 1.5, 0]);
const chefPuff = merged([
  placed(new SphereGeometry(0.26, 10, 8), [0, 1.78, 0]),
  placed(new SphereGeometry(0.2, 10, 8), [0.2, 1.7, 0.03]),
  placed(new SphereGeometry(0.2, 10, 8), [-0.2, 1.7, 0.03]),
  placed(new SphereGeometry(0.2, 10, 8), [0, 1.7, 0.2]),
]);

const m = (c: string) => toon(c);

function Propeller() {
  const blades = useRef<Group>(null);
  useFrame((s) => { if (blades.current) blades.current.rotation.y = s.clock.elapsedTime * 14; });
  return (
    <>
      <mesh geometry={propDome} material={m('#FF5A6E')} />
      <mesh geometry={propStick} material={m('#FFFFFF')} />
      <group ref={blades} position={[0, 1.8, 0]}><mesh geometry={propBlades} material={m('#FFC93C')} /></group>
    </>
  );
}

export function Hat({ id }: { id: HatId }) {
  switch (id) {
    case 'cap': return (<><mesh geometry={capDome} material={m('#3D5AFE')} /><mesh geometry={capBrim} material={m('#2A3FB5')} /></>);
    case 'beanie': return (<><mesh geometry={beanieDome} material={m('#FF9F43')} /><mesh geometry={beanieCuff} material={m('#FFFFFF')} /><mesh geometry={pom} material={m('#FFFFFF')} /></>);
    case 'propeller': return <Propeller />;
    case 'grad': return (<><mesh geometry={gradBand} material={m('#2B2D42')} /><mesh geometry={gradBoard} material={m('#2B2D42')} /><mesh geometry={gradTassel} material={m('#FFD23F')} /></>);
    case 'crown': return (<><mesh geometry={crownBand} material={m('#FFD23F')} /><mesh geometry={crownSpikes} material={m('#FFD23F')} /><mesh geometry={crownGem} material={m('#FF5A6E')} /></>);
    case 'laurel': return (<><mesh geometry={laurelRing} material={m('#2E9B4E')} /><mesh geometry={laurelLeaves} material={m('#4CC36A')} /></>);
    case 'goggles': return (<><mesh geometry={gogStrap} material={m('#2B2D42')} /><mesh geometry={gogFrames} material={m('#FF9F43')} /><mesh geometry={gogLens} material={basic('#9AE1FF')} /></>);
    case 'headphones': return (<><mesh geometry={hpBand} material={m('#2B2D42')} /><mesh geometry={hpCups} material={m('#FF4FA0')} /></>);
    case 'wizard': return (<><mesh geometry={wizCone} material={m('#6A3DE8')} /><mesh geometry={wizBrim} material={m('#5A31C9')} /><mesh geometry={wizBand} material={m('#FFD23F')} /></>);
    case 'flower': return (<><mesh geometry={flowerPetals} material={m('#FF7AB6')} /><mesh geometry={flowerHeart} material={m('#FFD23F')} /></>);
    case 'chef': return (<><mesh geometry={chefBand} material={m('#FFFFFF')} /><mesh geometry={chefPuff} material={m('#FFFFFF')} /></>);
    default: return null;
  }
}
