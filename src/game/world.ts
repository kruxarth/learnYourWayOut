import type { NavWorld } from './loop/navigation';
import { SpatialHash } from './loop/spatialHash';
import type { FloorRect, WallBox } from './types';

/** Everything the player controller and the renderer need for one scene (hub, course or arena). */
export interface World {
  walls: WallBox[];
  floors: FloorRect[];
  nav: NavWorld;
  hubRadius: number | null;
}

export function makeWorld(walls: WallBox[], floors: FloorRect[], hubRadius: number | null = null): World {
  return {
    walls, floors, hubRadius,
    nav: {
      wallHash: new SpatialHash(walls.filter((w) => w.isStatic)),
      floorHash: new SpatialHash(floors.filter((f) => f.isStatic)),
      dynWalls: walls.filter((w) => !w.isStatic),
      dynFloors: floors.filter((f) => !f.isStatic),
    },
  };
}
