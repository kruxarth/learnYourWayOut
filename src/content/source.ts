import type { DomainId } from '../game/types';
import type { DomainPack } from './schema';
import math from './domains/math.json';
import science from './domains/science.json';
import history from './domains/history.json';
import programming from './domains/programming.json';
import { validateDomainPack } from './validate';

type BuiltinId = Exclude<DomainId, 'custom'>;

/** All engine code gets questions through this interface. A v2 LLM source can implement it too. */
export interface QuestionSource {
  listDomains(): { id: DomainId; name: string; color: string }[];
  getPack(id: DomainId): DomainPack;
}

export class StaticQuestionSource implements QuestionSource {
  private packs: Record<BuiltinId, DomainPack>;
  private custom: DomainPack | null = null;
  constructor() {
    this.packs = {
      math: math as unknown as DomainPack,
      science: science as unknown as DomainPack,
      history: history as unknown as DomainPack,
      programming: programming as unknown as DomainPack,
    };
  }
  listDomains() {
    return (Object.keys(this.packs) as BuiltinId[]).map((id) => ({ id, name: this.packs[id].name, color: this.packs[id].color }));
  }
  getPack(id: DomainId): DomainPack {
    if (id !== 'custom') return this.packs[id];
    if (!this.custom) throw new Error('No custom pack is set');
    return this.custom;
  }
  /** Validate and store the generated "Any Topic" pack, which `getPack('custom')` then returns. */
  setCustomPack(pack: DomainPack): void {
    const errs = validateDomainPack(pack);
    if (pack.id !== 'custom') errs.push('custom pack must have id "custom"');
    if (errs.length) throw new Error(`Invalid custom pack: ${errs.slice(0, 3).join('; ')}`);
    this.custom = pack;
  }
  hasCustomPack(): boolean { return this.custom !== null; }
  /** The built-in packs only. */
  allPacks(): DomainPack[] { return Object.values(this.packs); }
}

export const questionSource = new StaticQuestionSource();
export const setCustomPack = (pack: DomainPack): void => questionSource.setCustomPack(pack);
