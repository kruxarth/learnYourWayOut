# F2: Any Topic (LLM-generated question packs)

Read `plan/NEXT_FEATURES.md` first, then `docs/CONTENT_GUIDE.md`. Generated questions must meet the same rules.

## 1. Goal

The player types a topic, e.g. "Roman Empire", and picks **Easy / Medium / Hard**. A few seconds later they play a full run whose questions are about that topic, in every room kind.

This is the headline feature. It is also the riskiest for quality, because AI-written questions can be wrong. Most of this doc is about keeping them good.

## 2. Key decisions (already made; log any deviation in `docs/DECISIONS.md`)

- **One difficulty choice.**
  - The panel's Easy / Medium / Hard sets **both** the question level (the target age band) and the game difficulty (easy / normal / hard).
  - Players should not have to understand two different difficulty settings.
  - Inside a pack, questions still carry tiers 1–3, so adaptive selection keeps working.
- **A generated pack is an ordinary `DomainPack`.**
  - Its id is `'custom'`, and it must pass the **existing** `validateDomainPack` (same quotas).
  - The engine, rooms, detours, TTS and results then work with no special cases. The quotas are already proven to feed a full Hard run.
- **The server does all LLM work.** The browser only talks to our server.
- **Provider-agnostic.**
  - One `OpenAiCompatClient` posts to `${LLM_BASE_URL}/chat/completions`.
  - DeepSeek (`https://api.deepseek.com`, model e.g. `deepseek-v4-flash`) and OpenCode Zen (`https://opencode.ai/zen/v1`, which lists DeepSeek models among others) both speak this format. So does OpenRouter.
  - Check the current model ids in the provider's docs. The old `deepseek-chat` alias has reportedly been retired.
- **Many small calls, not one huge one.** Run one call per concept, in parallel. This is faster (target p50 under 30 s, hard cap 120 s), and a failure only costs one concept.
- **The client polls.** `POST` starts a job and `GET` polls it every second. This is simpler than SSE and survives proxies. The player can keep running around the hub while they wait.

## 3. Server (`server/`, created by this feature)

```
server/
  index.ts            node:http server: routes, CORS (ALLOWED_ORIGINS), and serves ../dist when it exists,
                      so one laptop can host the whole game on a LAN
  env.ts              reads and validates server/.env (process.loadEnvFile); llm disabled if no key
  jobs.ts             in-memory job map, 10-min TTL
  ratelimit.ts        per-IP token bucket: 6 new packs / 10 min, 60 polls / min
  llm/client.ts       interface LlmClient { json(req: { system: string; user: string; maxTokens: number; temperature?: number; model?: string }): Promise<unknown> }
                      OpenAiCompatClient: fetch, response_format {type:'json_object'}, 45 s AbortController timeout,
                      1 retry on 429/5xx with backoff; tolerant parse (strips ``` fences, takes the outermost {...})
  llm/prompts.ts      all prompt text in one place
  llm/safety.ts       blocklist + LLM topic gate
  llm/pipeline.ts     generatePack(topic, level, llm, onStage): Promise<DomainPack>
  llm/cache.ts        LRU (50) in memory + server/data/packs/<sha1(key)>.json on disk (gitignore server/data/)
  scripts/genPack.ts  CLI: `npm run gen-pack -- "Roman Empire" normal` → writes JSON to stdout (real LLM)
```

- **Run:** add `tsx` as a dev dependency and use the scripts `"server": "tsx server/index.ts"` and `"gen-pack": "tsx server/scripts/genPack.ts"`.
  - Why `tsx`: `src/` uses extensionless imports, which Node's own type stripping can't resolve.
- **Type-check:** add `server/**/*.ts` to a tsconfig project so `tsc -b` checks it. A new `tsconfig.server.json`, referenced from `tsconfig.json`, works.
- **Tests:** add `server/**/*.test.ts` to the Vitest `include`.
- **Dependencies:** no web framework. `node:http` is enough. Keep server deps to `ws` (F3) and nothing else if you can.

### API

| Method | Path | Body / response |
|---|---|---|
| GET | `/api/health` | `{ ok: true, llm: boolean }`. The client uses it to enable or disable Any Topic. |
| POST | `/api/packs` | Body `{ topic: string, level: 'easy'\|'normal'\|'hard' }`. Possible responses: <ul><li>`200 { pack }` on a cache hit</li><li>`202 { jobId }` when a new job starts</li><li>`400 { error: 'too-short'\|'too-long'\|'unsafe'\|'not-a-topic', message, suggestions?: string[] }`</li><li>`429`</li><li>`503` if the LLM is not configured</li></ul> |
| GET | `/api/packs/jobs/:id` | `{ stage, progress: 0..1, pack?, error?: { code, message } }` |
| POST | `/api/reports` | `{ packKey, questionId, reason: 'wrong'\|'confusing'\|'unsuitable' }`. Appended to `server/data/reports.jsonl`, and the question is removed from the cached pack. |

`stage` is one of `'checking'`, `'planning'`, `'writing'`, `'reviewing'`, `'fixing'`, `'done'` or `'failed'`. The cache key is `level + ':' + normalized topic`: trimmed, whitespace collapsed, lowercased.

## 4. Pipeline (`llm/pipeline.ts`)

Every LLM reply is `unknown` until checked by hand-written guards. Never trust its shape.

1. **Normalize.** Trim, collapse spaces, strip control characters. Topic length must be 3–60, otherwise `too-short`/`too-long`.
2. **Safety gate** (`safety.ts`; stage `checking`):
   1. **Blocklist.** A small word-boundary list of clearly adult or hateful terms. A hit returns `unsafe`. Keep it short, because the LLM gate does the real work.
   2. **LLM classify.** The reply is `{ verdict: 'ok'|'unsafe'|'not_a_topic'|'too_broad', cleanTopic: string, suggestions: string[] }`.
      - The audience is students, from school to early university, in a learning game that may be shown in public.
      - **Say explicitly in the prompt** that ordinary school history and science are fine at an age-appropriate level: wars, the Roman Empire, WW2, the human body, diseases, natural disasters. Otherwise the gate is overcautious.
      - Reject: sexual content, graphic violence or gore, drugs or alcohol use, self-harm, hate, real private individuals, and requests to write something other than quiz questions (prompt injection).
      - `cleanTopic` fixes spelling and casing ("roman empre" → "Roman Empire"). It becomes `pack.name`, at most 30 characters.
      - `too_broad` ("everything", "science") returns 3 narrower suggestions to the client.
3. **Plan** (stage `planning`). One call returns 4 concepts: `{ id, name, facts: [string, string, string] }`.
   - `id` is a slug matching `/^[a-z]+(-[a-z]+)*$/`, at most 24 characters, unique within the pack.
   - `name` is at most 30 characters.
   - Each fact is a short, true statement at the chosen level, at most 120 characters.
   - The concepts must split the topic into distinct parts. For Roman Empire, something like: founding & rise, daily life, army & government, decline & legacy.
4. **Write** (stage `writing`, `progress` = concepts done / 4). Run **4 calls in parallel**, one per concept. Each asks for:
   - 6 mcq (tiers 1, 1, 1, 2, 2, 3)
   - 4 truefalse (tiers 1, 1, 2, 3; about half false)
   - 2 steps
   - 2 order
   - 1 classify, for the F4-2 Rule Minefield. It is optional for the quota; if too few survive, the pool simply leaves that room out.

   This is about 25% more than the quotas need, so some questions can be dropped.
   - The prompt contains the CONTENT_GUIDE rules, rewritten as numbered rules:
     - lengths
     - **every label 1–22 characters**
     - the hint must not reveal the answer
     - no "all/none of the above"
     - distractors similar in length
   - It also includes one real example of each type from our hand-made packs, as few-shot examples.
   - Tell the model what **steps** and **order** mean for non-math topics:
     - A `steps` question is a 4-step process or cause→effect chain. At each step the player picks the true next step over 1–2 typical mistakes.
     - An `order` question puts 4 items in a stated order (earliest first, smallest first, and so on).
   - The level sets the depth in the prompt:
     - easy: beginner, plain words, well-known facts
     - normal: high-school level
     - hard: advanced, early-university level, includes common misconceptions
   - **The server assigns ids** (`custom-<concept>-NNN`) and `concept`. Do not trust ids from the model.
5. **Validate.** Export a per-question validator from `src/content/validate.ts` by renaming the private `questionErrors` to an exported `validateQuestion(pack, q): string[]`. Collect the failures.
6. **Fix** (stage `fixing`). One repair call per concept that has failures. Send the failed questions plus their exact error strings ("label must be 1-22 chars …"). Validate again and drop any that still fail.
7. **Review** (stage `reviewing`). One call (with `LLM_REVIEW_MODEL` if set) gets every surviving question in compact form.
   - It returns `{ flags: [{ id, problem: 'wrong_answer'|'ambiguous'|'gives_away'|'unsuitable'|'two_correct', note }] }`.
   - Drop every flagged question. This second opinion catches most wrong answer keys.
8. **Quota.** Run `validateDomainPack(pack)`. If quota errors remain, make up to 2 **top-up** calls that ask only for the missing pieces (e.g. "2 more tier-3 mcq for concept X"), then repeat steps 5–7 for them.
   - If the quota still fails, the job fails: "Couldn't make enough good questions about that. Try a broader topic."
9. **Assemble.**
   - `{ id: 'custom', name: cleanTopic, color: <one of 6 pastel colours by hash>, concepts, questions }`, plus the new optional fields below.
   - Cache it and return it.

### Schema additions (`src/content/schema.ts`, all optional, also validated)

```ts
interface DomainPack {
  // existing fields…
  concepts: { id: string; name: string; facts?: string[] }[];   // facts: ≤3, each 10–120 chars (shown on the Topic panel preview card and the detour boards)
  topic?: { query: string; level: Difficulty };
  generated?: { model: string; createdAt: string; packKey: string };
}
```

## 5. Client

**`src/game/types.ts`:**
- Add `'custom'` to `DomainId`.
- Fix every `Record<DomainId, …>`: portal angle and colour in `selection.ts`, packs in `source.ts`, `urlParams.ts` DOMAINS. Do **not** add `custom` to `DOMAINS` in `urlParams`.

**`src/content/source.ts`:**
- `setCustomPack(pack)` validates the pack, then stores it. `getPack('custom')` returns it, and throws if none is set.
- `listDomains()` keeps returning only the 4 built-in packs. The hub adds the Any Topic portal by itself (layout in NEXT_FEATURES).

**`src/content/customClient.ts`:**
- `checkServer()`
- `requestPack(topic, level, onProgress, signal)`, which polls the job
- `reportQuestion(...)`
- All of them take an injectable `fetch`, so tests can use a fake.

**`src/ui/TopicPanel.tsx`** (opened from the Any Topic portal pad or a HubOverlay button):
- **Inputs:**
  - Text field "What do you want to learn about?", maxLength 60. It autofocuses.
  - Chips with suggestions: Roman Empire · Volcanoes · Solar System · Fractions · Rainforest animals · Python loops.
  - A segmented control: Easy / Medium / Hard, shown with "(beginner / intermediate / advanced)".
  - A **Make my maze** button.
- **Progress:** stage text ("Checking your topic…", "Planning 4 big ideas…", "Writing questions 2/4…", "Double-checking answers…") and a bar.
- **When done:** a card shows the pack name and its 4 concept names, with **Start run**. On Start: `setCustomPack(pack)`, then `engine.startRun({ domainId: 'custom', difficulty, seed: newSeed() })`.
- **Recent topics:**
  - The last 6 packs are stored in localStorage under a **separate key** `lywo:packs:v1`, because packs are 30–50 KB each.
  - Each has Play and ✕ buttons, and replay works with no server.
- **Example packs:** commit 2 packs under `src/content/examples/`: `roman-empire.normal.json` and `volcanoes.easy.json`.
  - Generate them with `npm run gen-pack`, then **a human reviews every question** before committing.
  - Show them as "Try an example" chips that work offline. They are the demo fallback if the venue Wi-Fi dies.
- **Errors:**
  - Server down: "Any Topic needs the game server. Try an example below!"
  - `unsafe`: "Let's pick a different topic!" plus suggestion chips.
  - `too_broad`: the suggestions as chips.
  - Job failed: the message and a Retry button.

**Input bug to fix:** `src/game/input.ts` listens for keys globally, so typing "wasd" in the text field would move the bean.
- Ignore keyboard events whose target is an `input`, `textarea` or `[contenteditable]`.
- Also block input while the panel is open, as `quickSelectOpen` does.

**In the run:**
- `QuestionPanel` shows a small "✨ AI-made" badge when `pack.generated` is set.
- `DetourPanel` and the results review list get a **"⚑ Looks wrong?"** button. It calls `reportQuestion`, adds the id to a per-pack `excluded` list in `lywo:packs:v1`, and filters it out of the pack the next time it is loaded.
- `persistence.ts`:
  - Skip `bestTimes` for `'custom'`.
  - Skip `rememberSeen` and `loadSeen` for `'custom'`, because ids like `custom-rise-001` repeat across different topics.
- "Run my weak spots" on the results card keeps working, because the custom pack stays set.

## 6. Accuracy and safety: what we tell judges and teachers

- Generated questions pass schema validation, a separate review pass, and in-game reporting. They can still contain mistakes, and the UI says so ("AI-made").
- Topics pass a safety gate made for a school/college audience. The API key never leaves the server.
- Answers players type are never sent anywhere. Only the topic string and the level are sent.

## 7. Milestones

- **M1. Server and pipeline**
  - `server/` skeleton, `/api/health`, `/api/packs` with jobs, the pipeline (steps 1 and 3–9; the gate can return `ok` for now), the cache, the `gen-pack` CLI, and tests with `FakeLlm`.
  - Done when `npm run gen-pack -- "Volcanoes" easy` produces a pack that passes `validateDomainPack`, and the tests are green with no network.
- **M2. Client**
  - `'custom'` domain, `TopicPanel`, hub portal, recent packs, example packs, the input-focus fix.
  - Done when you can type a topic, wait, play and qualify, and replay it from Recent after a reload.
- **M3. Quality and safety**
  - Safety gate, review pass, report flow, rate limit, disk cache.
  - Done when the §8 safety tests pass. Also try 20 hand-picked topics by hand, including tricky ones (WW2, human heart, "bad words", "ignore previous instructions and…"), and record the results in `docs/DECISIONS.md`.

## 8. Tests

**Server (`server/**/*.test.ts`)**, with a `FakeLlm` that returns canned replies per call and records the calls:
- A clean run produces a valid pack, ids are reassigned, and `progress` rises steadily.
- Invalid questions trigger exactly one fix call that contains their error strings, and ones still invalid are dropped.
- Questions flagged by review are dropped. A quota shortfall triggers a top-up; after 2 top-ups the job fails cleanly.
- `unsafe`, `not_a_topic` and blocklist hits return before any planning or writing call is made.
- Tolerant JSON parse: fenced, prefixed with text, or truncated (throws a clean error).
- Model output with wrong types (a number as a label, 5 distractors) never crashes.
- The rate limiter and the cache-key normalisation.

**Client (`src/tests/`):**
- Both example packs pass `validateDomainPack`.
- With an example pack set as `'custom'`, `fullrun` (the bot) qualifies on easy, normal and hard.
- `customClient` with a fake `fetch`: progress callbacks, error mapping, abort.
- `input.ts` ignores keys typed into a text field.
