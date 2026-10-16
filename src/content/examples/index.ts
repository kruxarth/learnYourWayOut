import type { Difficulty } from '../../game/types';
import type { DomainPack } from '../schema';
import roman from './roman-empire.normal.json';
import volcanoes from './volcanoes.easy.json';

/** Hand-checked Any Topic packs that work offline. They are the demo fallback if the server or Wi-Fi is down. */
export interface ExamplePack { label: string; level: Difficulty; pack: DomainPack }

export const EXAMPLE_PACKS: ExamplePack[] = [
  { label: 'Roman Empire', level: 'normal', pack: roman as unknown as DomainPack },
  { label: 'Volcanoes', level: 'easy', pack: volcanoes as unknown as DomainPack },
];
