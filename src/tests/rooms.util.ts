import { engine } from '../game/engine';

export function useLifelineSafe(kind: 'fifty' | 'hint'): void {
  engine.useLifeline(kind);
}
