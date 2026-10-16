# F1: Custom avatars and wardrobe

Read `plan/NEXT_FEATURES.md` first.

## 1. Goal

Replace the single pink bean (`src/render/Bean.tsx`, colour `PAL.bean`) with a character players can customise. They pick a colour, a face, a hat and an extra, and they unlock more items by learning.

The same avatar is used for:
- the local player
- remote players (F3)
- daily-challenge ghosts (F4-D)
- the wardrobe preview and the results card

## 2. Art direction

- **The goal is the Among Us *feel*: a chunky, readable silhouette in one strong body colour, plus a hat.** That is why players recognise each other at a glance.
- **Do not copy the Among Us crewmate.** The crewmate's visor and backpack shape is Innersloth's recognisable design. A look-alike in a pitch is a bad look for judges.
- **Keep our own jelly-bean body** (a capsule, already Fall Guys-like) and make it ours:
  - a slightly bigger head end
  - a face plate (eyes and mouth) on the front
  - stubby rounded feet: two small spheres that alternate with the waddle
  - optional stubby arms
- **Build from primitives only:** capsule, sphere, cylinder, cone, torus, box. Use no GLTF files, no image assets and no new dependencies.
  - Every material comes from `toon(color)` in `src/render/materials.ts`, which is already cached.
- **Budget:** at most 14 meshes per avatar. With 8 players, the game draws about 110 avatar meshes, which is fine.
- **School-appropriate:** no weapons, no real brands or flags.

## 3. Data (engine side, pure TS): `src/game/avatar.ts`

```ts
export type BodyColorId = 'pink' | 'red' | 'orange' | 'yellow' | 'lime' | 'teal' | 'sky' | 'blue' | 'purple' | 'brown' | 'white' | 'black';
export type EyesId = 'round' | 'happy' | 'sleepy' | 'wide' | 'wink' | 'glasses';
export type MouthId = 'smile' | 'grin' | 'o' | 'none';
export type HatId = 'none' | 'cap' | 'beanie' | 'propeller' | 'grad' | 'crown' | 'laurel' | 'goggles' | 'headphones' | 'wizard' | 'flower' | 'chef';
export type ExtraId = 'none' | 'scarf' | 'bowtie' | 'bookbag' | 'cape';

export interface AvatarConfig { v: 1; body: BodyColorId; eyes: EyesId; mouth: MouthId; hat: HatId; extra: ExtraId }
export const DEFAULT_AVATAR: AvatarConfig = { v: 1, body: 'pink', eyes: 'round', mouth: 'smile', hat: 'none', extra: 'none' };

export type Unlock =
  | { kind: 'free' }
  | { kind: 'stars'; n: number }            // lifetime stars
  | { kind: 'achievement'; id: AchievementId };

export interface CatalogItem { slot: 'body' | 'eyes' | 'mouth' | 'hat' | 'extra'; id: string; name: string; unlock: Unlock }
export const AVATAR_CATALOG: CatalogItem[] = [ /* … */ ];

export function sanitizeAvatar(x: unknown): AvatarConfig;       // unknown ids → default for that slot
export function isUnlocked(item: CatalogItem, p: Progress): boolean;
export function unlocksAfterRun(before: Progress, after: Progress): CatalogItem[]; // for the "new item!" toast
```

**Colours:**
- Put the colours in `src/game/palette.ts` as `BODY_COLORS: Record<BodyColorId, string>`.
- They must be distinct from each other, from hedge green and from the cream floor.
- Every colour has a name. F3 name tags and screen readers use it, and hats help colour-blind players tell avatars apart.
- `pink` stays `PAL.bean`, so the default player looks like today.

**Unlocks: learning earns cosmetics.**
- Do **not** spend in-run coins on cosmetics. Coins are the lifeline economy (`COST_FIFTY`, `COST_HINT`).
- Instead, use lifetime **stars**, from `RunResult.stars` (0–3 per run, `computeStars` in `evaluation.ts`), and **achievements**.

| Item | Unlock |
|---|---|
| All 12 colours, eyes `round`/`happy`/`sleepy`, all mouths, hats `none`/`cap`/`beanie`, extras `none`/`scarf` | free |
| `propeller`, `bowtie`, `wide`, `wink` | 3 / 6 / 10 / 15 stars |
| `laurel` | qualify in History |
| `goggles` | qualify in Science |
| `headphones` | qualify in Programming |
| `grad` | qualify in Math |
| `wizard` | qualify on an Any Topic run (F2) |
| `crown` | 3 stars on Hard |
| `glasses` | answer 50 questions right in total |
| `bookbag` | finish 3 weak-spot runs ("Run my weak spots") |
| `chef`, `flower`, `cape` | 25 / 40 / 60 stars |

Achievements:
- Define `AchievementId` and a pure `achievementsAfterRun(progress, result): AchievementId[]`.
- If F2 isn't merged yet, the `wizard` check looks for `selection.domainId === 'custom'`. Add the type member when F2 lands.

## 4. Save data (`src/game/persistence.ts`)

Add these optional fields. `loadSave()` must sanitize every one of them.

```ts
avatar?: AvatarConfig;          // sanitizeAvatar on load
playerName?: string;            // re-run cleanName on load (see §6); if it fails, show the name prompt again
stars?: number;                 // lifetime total
correctTotal?: number;
achievements?: string[];        // unknown ids dropped
```

- `recordRun(result)` adds stars and correct answers and evaluates achievements.
- It returns the newly unlocked items so the results card can show them. Today it returns `void`; change the return type and update its caller in `outcome.ts`.
- `?demo=1` must not change progress. Follow the `seen` precedent.

## 5. Rendering

**`src/render/avatar/Avatar.tsx`: a presentational component.**
- Signature: `<Avatar config={AvatarConfig} pose={AvatarPose} />`.
- `AvatarPose` is a mutable ref object: `{ squash, lean, waddle, spinAngle, spinAxisX, spinAxisZ, blink, footPhase }`.
- `Avatar` reads the pose in its own `useFrame` and applies it to child groups. It owns **no** physics.

**Parts:**
- One file per slot: `avatar/parts/Hats.tsx`, `Faces.tsx`, `Extras.tsx`. Each is a `switch` on the id that returns a small group.
- Geometries are created once at module level and shared by every avatar. Never create them in `useFrame`, and not per-instance unless they're memoised.

**`Bean.tsx` refactor:**
- It keeps the spring, lean, waddle, blink and spin logic it has now, writes the results into an `AvatarPose` ref, and renders `<Avatar config={…from the store…} pose={pose} />`.
- It must look exactly like today with `DEFAULT_AVATAR` plus the new feet.
- `Math.random()` in Bean (blink timing, spin axis) is fine. It's render-only cosmetic code, not engine code.

**Other uses:**
- **Reduced motion** setting: no idle bob and no waddle.
- **`AvatarThumb`:** a static, pose-free version for the wardrobe grid and the F3 lobby. Use one small shared `<Canvas>` per panel, not one per item.
- **Hats near mazes:** wrap their materials with `withVisibility` like everything else. `toon()` already does this.

## 6. Player names: `src/game/names.ts`

Players **type their own name**. A 🎲 button fills in a random suggestion.

- **`cleanName(raw): { ok: true; name: string } | { ok: false; reason: 'too-short' | 'too-long' | 'not-allowed' }`**
  1. NFKC-normalise the name.
  2. Strip control characters, zero-width characters and bidi overrides.
  3. Collapse whitespace and trim.
  4. Check the length: 2–16 characters, after cleaning.
  5. Check the allowed characters: letters (any script), digits, space, `_ - . '`. No emoji, no symbols, so names render reliably on a `labelTexture`.
  6. Check a **small profanity list** (`src/game/profanity.ts`, about 100 common English and Hindi words). Match on a lowercased copy with leet-speak folded (`0→o, 1→i, 3→e, 4→a, 5→s, @→a, $→s`) and separators removed.
     - The list will never be perfect. It exists so that the obvious word on a projector during judging gets blocked.
- **Random suggestions:** two word lists, about 60 adjectives (Brave, Sunny, Curious …) and about 60 animals (Otter, Panda, Gecko …). `randomName(rng)` combines them, e.g. "Curious Otter".
- **Where names are used:** the name field sits in the Wardrobe. On first launch, the game shows a one-time "What should we call you?" prompt, pre-filled with a random suggestion so Enter just works.
- **Server checks:** F3's server runs the same `cleanName` and rejects names that fail it.
- **Duplicates in a room:** the server appends " 2", " 3", and so on.

## 7. Wardrobe UI: `src/ui/Wardrobe.tsx`

- Opens from the hub's Wardrobe pad at (−6, 9) or from a `HubOverlay` button. Close it with Esc.
- While it is open, input is blocked, as with `quickSelectOpen`.
- **Layout:**
  - On the left, a live preview: its own small `<Canvas>` with a slowly turning `Avatar` and a soft light. Unmount it on close.
  - On the right, tabs (Colour · Face · Hat · Extra), each a grid of items.
  - A locked item shows a lock and its unlock text, e.g. "Qualify in History".
- **Buttons:** 🎲 Randomise (only from unlocked items), a name text field (max 16) with a 🎲 suggestion button and an inline error from `cleanName`, Done.
- Every choice saves immediately with `saveAvatar(config)` and updates `useUI` (`avatar`, `playerName`).
- It must work with mouse, touch and keyboard (arrow keys move between items, Enter selects).

**Results card:** if `recordRun` returned new unlocks, show "New hat unlocked: Laurel wreath!" with the item thumbnail and a "Try it on" button that opens the Wardrobe from the hub.

## 8. Milestones

- **A1. Data and component**
  - `avatar.ts`, `Avatar.tsx`, the parts, and the Bean refactor.
  - Temporary `?avatar=` URL param (debug only) to try configs.
  - Done when the default looks like today's bean with feet, every part renders, and `npm run check` is green.
- **A2. Wardrobe, names and save**
  - Wardrobe panel, hub pad and button, name field with `cleanName`, persistence.
  - Done when choices survive a reload and an old save without the new fields loads cleanly.
- **A3. Unlocks**
  - Stars, achievements, locked items in the wardrobe, results-card toast.

## 9. Tests (`src/tests/avatar.test.ts`)

- Catalog ids are unique per slot, and every `AvatarConfig` slot value has a catalog entry.
- `sanitizeAvatar` handles garbage, unknown ids, a missing `v` and non-objects.
- Every `achievement` unlock references a real `AchievementId`, and every free item set gives at least 3 choices per slot.
- `achievementsAfterRun`:
  - Qualifying in History grants `laurel`.
  - An eliminated run grants no qualify-achievements.
  - Demo runs never change progress.
- `names.ts`:
  - Every `randomName` output passes `cleanName`.
  - `cleanName` trims and collapses spaces, and rejects names that are 1 or 17+ characters long, emoji, zero-width tricks (`"a​b"` → `"ab"`) and leet-speak profanity.
  - It accepts non-English names (`"Ananya"`, `"José"`, `"अर्जुन"`).
- `loadSave` with an old v1 save, without the new fields, returns defaults.

## 10. Done when

- A judge can open the wardrobe, make a character, and see it run the course, all within 30 seconds.
- Every item is visible from the default camera and doesn't clip through hedges badly.
- Frame time in the Hard maze is no worse than before on a mid-range laptop. Check this with the `?debug=1` overlay.
