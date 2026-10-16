import type { RoomKind, RunResult } from './types';

export type GameEvent =
  | { type: 'countdown'; n: 3 | 2 | 1 | 0 }
  | { type: 'jump' }
  | { type: 'land'; impact: number }
  | { type: 'coin'; x: number; y: number; z: number }
  | { type: 'speedPad' }
  | { type: 'roomActivated'; roomId: string; kind: RoomKind }
  | { type: 'answer'; roomId: string; correct: boolean; firstTry: boolean; x: number; y: number; z: number }
  | { type: 'doorBurst'; x: number; y: number; z: number }
  | { type: 'doorWrong'; x: number; y: number; z: number }
  | { type: 'bounce' }
  | { type: 'launch'; x: number; y: number; z: number }
  | { type: 'stepCorrect' } | { type: 'stepWrong' }
  | { type: 'tileShake' }
  | { type: 'fall' }
  | { type: 'detourEnter' } | { type: 'detourExit' }
  | { type: 'slimeSurge'; amount: number }
  | { type: 'blockPickup' } | { type: 'blockPlaced'; correct: boolean }
  | { type: 'bridgeComplete' }
  | { type: 'lifeline'; kind: 'fifty' | 'hint'; ok: boolean }
  | { type: 'win' } | { type: 'lose' }
  | { type: 'uiClick' }
  /** The run's result was built (the results card is about to show). The net layer sends `finish` on it. */
  | { type: 'runResult'; result: RunResult };

export type Handler<E> = (e: E) => void;

/** Tiny typed emitter. Subscribers receive every event and switch on `type`. */
export class Emitter<E extends { type: string }> {
  private handlers = new Set<Handler<E>>();
  on(fn: Handler<E>): () => void {
    this.handlers.add(fn);
    return () => this.off(fn);
  }
  off(fn: Handler<E>): void {
    this.handlers.delete(fn);
  }
  emit(e: E): void {
    for (const fn of this.handlers) fn(e);
  }
}
