# Content guide

Questions live in `src/content/domains/<domain>.json` and are validated by `npm test`.

## Schema
Every question has `id` (`<domain>-<concept>-<nnn>`), `type`, `concept`, `tier` (1–3), `prompt` (8–120 chars), `hint` (4–90, must not give the answer away) and `explanation` (10–180). `workedExample` is optional (≤220).
- `mcq`: `answer` plus exactly 3 `distractors`.
- `truefalse`: boolean `answer`.
- `steps`: 4 rows, each with `correct`, 1–2 `wrong`, optional `why` (≤90).
- `order`: 4 `items` in the correct order.
- `classify` (optional, Rule Minefield): `prompt` is the rule ("Step only on prime numbers"), `items` has 8-10 `{ label, fits }` entries, at least 3 that fit and 3 that do not, all labels different. Only use items you are 100% sure about, and avoid borderline cases.
Every label (answer, distractor, step, item) is 1–22 characters so it fits on a door, tile or block.

## Authoring rules
1. Accuracy first. If unsure of a fact, leave it out.
2. Tier 1 recalls a fact, tier 2 applies a rule, tier 3 combines ideas or hits a misconception.
3. Distractors are plausible, similar in length, and never "all/none of the above".
4. About half of true/false statements are false.
5. Steps: each wrong option is a typical mistake at that step. Order: say the direction in the prompt.
6. Code in prompts: one line, backticks around code.
7. Simple international English.

## Quotas per domain
≥16 mcq (≥4 per concept; per concept ≥2 tier 1, ≥1 tier 2, ≥1 tier 3), ≥8 truefalse (≥2 per concept, ≥1 tier 1), ≥4 steps (≥2 concepts, all three tiers), ≥4 order (≥2 concepts). `classify` is optional in the quotas, but the Rule Minefield room is only in the pool when a pack has ≥4 of them (hand packs: 4 per domain, ≥2 concepts, mixed tiers).

## Add a question
Append to the domain's `questions` with the next id, then run `npm test`.

## Add a domain
Create a JSON pack with 4 concepts, register it in `content/source.ts` and the `DomainId` type, and add a portal angle in `loop/selection.ts`.

## Any Topic packs
Generated packs are ordinary packs with id `custom` (ids `custom-<concept>-<nnn>`), checked by the same `validateDomainPack`. Concepts may carry up to 3 `facts` (10-120 chars). Packs also carry optional `topic` and `generated` metadata. The two examples in `src/content/examples/` are hand-written in this shape (`generated.model` is `hand-written`). `npm run gen-pack` output needs a human review of every question before it is committed.
