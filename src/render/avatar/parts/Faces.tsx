import type { Ref } from 'react';
import { CircleGeometry, SphereGeometry, TorusGeometry, type Group } from 'three';
import type { EyesId, MouthId } from '../../../game/avatar';
import { basic, merged, placed } from '../geo';

const WHITE = '#ffffff', INK = '#111111', MOUTH = '#5a2330';

// Shared geometries (created once, never in useFrame). The body surface in front is at about z = -0.43.
const white = new SphereGeometry(0.13, 12, 10);
const whiteBig = new SphereGeometry(0.17, 12, 10);
const pupil = new SphereGeometry(0.065, 10, 8);
const pupilBig = new SphereGeometry(0.08, 10, 8);
const arcEye = new TorusGeometry(0.09, 0.03, 6, 12, Math.PI);
const arcEyeDown = placed(arcEye, [0, 0, 0], [0, 0, Math.PI]);
const frames = merged([
  placed(new TorusGeometry(0.17, 0.03, 6, 16), [-0.15, 0, -0.5]),
  placed(new TorusGeometry(0.17, 0.03, 6, 16), [0.15, 0, -0.5]),
  placed(new SphereGeometry(0.03, 6, 6), [0, 0.02, -0.5], [0, 0, 0], [1.2, 0.6, 0.6]),
]);
const smile = new TorusGeometry(0.1, 0.028, 6, 14, Math.PI);
const smileDown = placed(smile, [0, 0, 0], [0, 0, Math.PI]);
const grinGeo = new CircleGeometry(0.13, 14, Math.PI, Math.PI);
const oGeo = new SphereGeometry(0.06, 10, 8);

function Eye({ x, big, sleepy }: { x: number; big?: boolean; sleepy?: boolean }) {
  return (
    <group position={[x, 0, 0]}>
      <mesh geometry={big ? whiteBig : white} position={[0, 0, -0.38]} scale={sleepy ? [1, 0.55, 1] : 1} material={basic(WHITE)} />
      <mesh geometry={big ? pupilBig : pupil} position={[0, sleepy ? -0.025 : 0, big ? -0.52 : -0.49]} material={basic(INK)} />
    </group>
  );
}

/** Eyes live in a group at eye height. `groupRef` is scaled in Y by the pose's blink. */
export function Eyes({ id, groupRef }: { id: EyesId; groupRef: Ref<Group> }) {
  return (
    <group ref={groupRef} position={[0, 1.15, 0]}>
      {id === 'round' && (<><Eye x={-0.15} /><Eye x={0.15} /></>)}
      {id === 'wide' && (<><Eye x={-0.15} big /><Eye x={0.15} big /></>)}
      {id === 'sleepy' && (<><Eye x={-0.15} sleepy /><Eye x={0.15} sleepy /></>)}
      {id === 'happy' && (
        <>
          <mesh geometry={arcEye} position={[-0.15, -0.04, -0.435]} material={basic(INK)} />
          <mesh geometry={arcEye} position={[0.15, -0.04, -0.435]} material={basic(INK)} />
        </>
      )}
      {id === 'wink' && (
        <>
          <Eye x={-0.15} />
          <mesh geometry={arcEyeDown} position={[0.15, 0.02, -0.435]} material={basic(INK)} />
        </>
      )}
      {id === 'glasses' && (
        <>
          <Eye x={-0.15} /><Eye x={0.15} />
          <mesh geometry={frames} material={basic(INK)} />
        </>
      )}
    </group>
  );
}

export function Mouth({ id }: { id: MouthId }) {
  switch (id) {
    case 'smile': return <mesh geometry={smileDown} position={[0, 0.98, -0.43]} material={basic(MOUTH)} />;
    case 'grin': return <mesh geometry={grinGeo} position={[0, 0.9, -0.435]} rotation={[0, 0, 0]} material={basic(MOUTH)} />;
    case 'o': return <mesh geometry={oGeo} position={[0, 0.9, -0.42]} scale={[1, 1.2, 0.3]} material={basic(MOUTH)} />;
    default: return null;
  }
}
