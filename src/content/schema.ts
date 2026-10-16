import type { Difficulty, DomainId } from '../game/types';

export type QuestionType = 'mcq' | 'truefalse' | 'steps' | 'order' | 'classify';

interface QBase {
  id: string;             // '<domain>-<concept>-<nnn>'
  type: QuestionType;
  concept: string;        // concept id of this domain
  tier: 1 | 2 | 3;
  prompt: string;         // 8–120 chars
  hint: string;           // 4–90 chars, must not give the answer away
  explanation: string;    // 10–180 chars
  workedExample?: string; // ≤ 220 chars
}
export interface McqQuestion extends QBase { type: 'mcq'; answer: string; distractors: [string, string, string] }
export interface TfQuestion extends QBase { type: 'truefalse'; answer: boolean }
export interface StepRow { correct: string; wrong: string[]; why?: string }
export interface StepsQuestion extends QBase { type: 'steps'; steps: [StepRow, StepRow, StepRow, StepRow] }
export interface OrderQuestion extends QBase { type: 'order'; items: [string, string, string, string] }
/** Rule Minefield: `prompt` is the rule ("Step only on prime numbers"); 8-10 items, at least 3 fit and 3 do not. */
export interface ClassifyItem { label: string; fits: boolean }
export interface ClassifyQuestion extends QBase { type: 'classify'; items: ClassifyItem[] }
export type Question = McqQuestion | TfQuestion | StepsQuestion | OrderQuestion | ClassifyQuestion;

export interface DomainPack {
  id: DomainId;
  name: string;
  color: string;
  concepts: { id: string; name: string; facts?: string[] }[]; // facts: at most 3, each 10–120 chars
  questions: Question[];
  /** Set on generated ("Any Topic") packs. */
  topic?: { query: string; level: Difficulty };
  generated?: { model: string; createdAt: string; packKey: string };
}
