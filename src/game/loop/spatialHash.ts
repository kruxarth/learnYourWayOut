export interface Rect { minX: number; maxX: number; minZ: number; maxZ: number }

/**
 * Static XZ lookup (spec §9.8). Cell size 4 m. Items are inserted into every cell they
 * overlap; queries return a de-duplicated list using a stamp counter (no allocation).
 */
export class SpatialHash<T extends Rect> {
  private cells = new Map<number, number[]>();
  private items: T[] = [];
  private stamps: Int32Array;
  private stamp = 0;
  private readonly size: number;

  constructor(items: readonly T[], size = 4) {
    this.size = size;
    this.items = items.slice();
    this.stamps = new Int32Array(this.items.length);
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      const x0 = Math.floor(it.minX / size), x1 = Math.floor(it.maxX / size);
      const z0 = Math.floor(it.minZ / size), z1 = Math.floor(it.maxZ / size);
      for (let ix = x0; ix <= x1; ix++) {
        for (let iz = z0; iz <= z1; iz++) {
          const k = key(ix, iz);
          let list = this.cells.get(k);
          if (!list) { list = []; this.cells.set(k, list); }
          list.push(i);
        }
      }
    }
  }

  /** Fill `out` with unique items overlapping the rectangle. Returns the count. */
  query(minX: number, maxX: number, minZ: number, maxZ: number, out: T[]): number {
    const s = this.size;
    this.stamp++;
    let n = 0;
    const x0 = Math.floor(minX / s), x1 = Math.floor(maxX / s);
    const z0 = Math.floor(minZ / s), z1 = Math.floor(maxZ / s);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const list = this.cells.get(key(ix, iz));
        if (!list) continue;
        for (let j = 0; j < list.length; j++) {
          const idx = list[j];
          if (this.stamps[idx] === this.stamp) continue;
          this.stamps[idx] = this.stamp;
          out[n++] = this.items[idx];
        }
      }
    }
    return n;
  }
}

function key(ix: number, iz: number): number {
  return (ix + 4096) * 8192 + (iz + 4096);
}
