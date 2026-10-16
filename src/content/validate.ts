import type { DomainPack, Question } from './schema';

const ID_RE = /^[a-z]+-[a-z-]+-\d{3}$/;
const BANNED = ['all of the above', 'none of the above'];

function len(s: unknown, min: number, max: number): boolean {
  return typeof s === 'string' && s.length >= min && s.length <= max;
}

function labelErrors(q: Question, label: unknown, what: string, out: string[]): void {
  if (!len(label, 1, 22)) out.push(`${q.id}: ${what} must be 1-22 chars (got ${JSON.stringify(label)})`);
  else if (BANNED.some((b) => (label as string).toLowerCase().includes(b))) out.push(`${q.id}: ${what} uses a banned phrase`);
}

function questionErrors(pack: DomainPack, q: Question, out: string[]): void {
  const concepts = new Set(pack.concepts.map((c) => c.id));
  if (!ID_RE.test(q.id)) out.push(`${q.id}: id does not match ${ID_RE}`);
  else if (!q.id.startsWith(`${pack.id}-${q.concept}-`)) out.push(`${q.id}: id prefix must be ${pack.id}-${q.concept}-`);
  if (!concepts.has(q.concept)) out.push(`${q.id}: unknown concept "${q.concept}"`);
  if (q.tier !== 1 && q.tier !== 2 && q.tier !== 3) out.push(`${q.id}: tier must be 1, 2 or 3`);
  if (!len(q.prompt, 8, 120)) out.push(`${q.id}: prompt must be 8-120 chars (${q.prompt?.length})`);
  if (!len(q.hint, 4, 90)) out.push(`${q.id}: hint must be 4-90 chars (${q.hint?.length})`);
  if (!len(q.explanation, 10, 180)) out.push(`${q.id}: explanation must be 10-180 chars (${q.explanation?.length})`);
  if (q.workedExample !== undefined && !len(q.workedExample, 1, 220)) out.push(`${q.id}: workedExample must be <= 220 chars`);

  switch (q.type) {
    case 'mcq': {
      if (!Array.isArray(q.distractors) || q.distractors.length !== 3) { out.push(`${q.id}: mcq needs exactly 3 distractors`); break; }
      const all = [q.answer, ...q.distractors];
      all.forEach((l, i) => labelErrors(q, l, i === 0 ? 'answer' : `distractor ${i}`, out));
      const norm = all.map((l) => String(l).trim().toLowerCase());
      if (new Set(norm).size !== norm.length) out.push(`${q.id}: answer and distractors must all differ`);
      break;
    }
    case 'truefalse':
      if (typeof (q.answer as unknown) !== 'boolean') out.push(`${q.id}: truefalse answer must be boolean`);
      break;
    case 'steps': {
      if (!Array.isArray(q.steps) || q.steps.length !== 4) { out.push(`${q.id}: steps needs exactly 4 rows`); break; }
      q.steps.forEach((row, i) => {
        if (!Array.isArray(row.wrong) || row.wrong.length < 1 || row.wrong.length > 2) out.push(`${q.id}: row ${i} needs 1-2 wrong items`);
        const labels = [row.correct, ...(row.wrong ?? [])];
        labels.forEach((l) => labelErrors(q, l, `row ${i} label`, out));
        const norm = labels.map((l) => String(l).trim().toLowerCase());
        if (new Set(norm).size !== norm.length) out.push(`${q.id}: row ${i} labels must differ`);
        if (row.why !== undefined && !len(row.why, 1, 90)) out.push(`${q.id}: row ${i} why must be <= 90 chars`);
      });
      break;
    }
    case 'order': {
      if (!Array.isArray(q.items) || q.items.length !== 4) { out.push(`${q.id}: order needs exactly 4 items`); break; }
      q.items.forEach((l, i) => labelErrors(q, l, `item ${i}`, out));
      const norm = q.items.map((l) => String(l).trim().toLowerCase());
      if (new Set(norm).size !== 4) out.push(`${q.id}: order items must differ`);
      break;
    }
    case 'classify': {
      if (!Array.isArray(q.items) || q.items.length < 8 || q.items.length > 10) { out.push(`${q.id}: classify needs 8-10 items`); break; }
      let fit = 0;
      q.items.forEach((it, i) => {
        labelErrors(q, it?.label, `item ${i}`, out);
        if (typeof it?.fits !== 'boolean') out.push(`${q.id}: item ${i} needs a boolean "fits"`);
        else if (it.fits) fit++;
      });
      if (fit < 3 || q.items.length - fit < 3) out.push(`${q.id}: classify needs >= 3 items that fit and >= 3 that do not`);
      const norm = q.items.map((it) => String(it?.label).trim().toLowerCase());
      if (new Set(norm).size !== norm.length) out.push(`${q.id}: classify items must all differ`);
      break;
    }
    default:
      out.push(`${(q as { id: string }).id}: unknown question type`);
  }
}

/** Errors for one question of `pack` (the pack only supplies its id and concepts). */
export function validateQuestion(pack: Pick<DomainPack, 'id' | 'concepts'>, q: Question): string[] {
  const out: string[] = [];
  questionErrors(pack as DomainPack, q, out);
  return out;
}

function quotaErrors(pack: DomainPack, out: string[]): void {
  for (const c of pack.concepts) {
    if (c.facts === undefined) continue;
    if (!Array.isArray(c.facts) || c.facts.length > 3 || c.facts.some((f) => !len(f, 10, 120))) out.push(`${pack.id}/${c.id}: facts must be at most 3 strings of 10-120 chars`);
  }
  const by = (t: string) => pack.questions.filter((q) => q.type === t);
  const mcq = by('mcq'), tf = by('truefalse'), steps = by('steps'), order = by('order');
  if (mcq.length < 16) out.push(`${pack.id}: needs >= 16 mcq (has ${mcq.length})`);
  if (tf.length < 8) out.push(`${pack.id}: needs >= 8 truefalse (has ${tf.length})`);
  if (steps.length < 4) out.push(`${pack.id}: needs >= 4 steps (has ${steps.length})`);
  if (order.length < 4) out.push(`${pack.id}: needs >= 4 order (has ${order.length})`);
  for (const c of pack.concepts) {
    const m = mcq.filter((q) => q.concept === c.id);
    if (m.length < 4) out.push(`${pack.id}/${c.id}: needs >= 4 mcq (has ${m.length})`);
    if (m.filter((q) => q.tier === 1).length < 2) out.push(`${pack.id}/${c.id}: needs >= 2 tier-1 mcq`);
    if (m.filter((q) => q.tier === 2).length < 1) out.push(`${pack.id}/${c.id}: needs >= 1 tier-2 mcq`);
    if (m.filter((q) => q.tier === 3).length < 1) out.push(`${pack.id}/${c.id}: needs >= 1 tier-3 mcq`);
    const t = tf.filter((q) => q.concept === c.id);
    if (t.length < 2) out.push(`${pack.id}/${c.id}: needs >= 2 truefalse (has ${t.length})`);
    if (t.filter((q) => q.tier === 1).length < 1) out.push(`${pack.id}/${c.id}: needs >= 1 tier-1 truefalse`);
  }
  if (new Set(steps.map((q) => q.concept)).size < 2) out.push(`${pack.id}: steps must cover >= 2 concepts`);
  for (const tier of [1, 2, 3]) if (!steps.some((q) => q.tier === tier)) out.push(`${pack.id}: steps needs a tier-${tier} question`);
  if (new Set(order.map((q) => q.concept)).size < 2) out.push(`${pack.id}: order must cover >= 2 concepts`);
}

/** Returns all errors for one pack. Pass `seenIds` to also check uniqueness across packs. */
export function validateDomainPack(pack: DomainPack, seenIds: Set<string> = new Set()): string[] {
  const out: string[] = [];
  const local = new Set<string>();
  for (const q of pack.questions) {
    if (local.has(q.id) || seenIds.has(q.id)) out.push(`${q.id}: duplicate id`);
    local.add(q.id);
    questionErrors(pack, q, out);
  }
  for (const id of local) seenIds.add(id);
  quotaErrors(pack, out);
  return out;
}

export function validatePacks(packs: DomainPack[]): string[] {
  const seen = new Set<string>();
  return packs.flatMap((p) => validateDomainPack(p, seen));
}
