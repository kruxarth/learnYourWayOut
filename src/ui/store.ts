import { create } from 'zustand';
import { DEFAULT_AVATAR, parseAvatarParam, type AvatarConfig, type CatalogItem } from '../game/avatar';
import type { DailyOutcome } from '../game/daily';
import { DEFAULT_SETTINGS, loadSave } from '../game/persistence';
import { params } from '../game/urlParams';
import type { DomainId, Difficulty, PowerKind, RoomKind, RunResult, RunSelection, Screen, Tier, Zone } from '../game/types';

export interface RoomPanel {
  roomId: string;
  kind: RoomKind;
  title: string;
  subtitle: string;
  prompt: string;
  footer: string;
  timer?: { remaining: number; total: number; started: boolean };
  steps?: { index: number; total: number; working: string[] };
  bridge?: { placed: number; total: number; carrying: string | null };
  hint?: string | null;
  feedback?: { text: string; tone: 'good' | 'bad' } | null;
  canFifty: boolean; canHint: boolean; fiftyUsed: boolean; hintUsed: boolean;
  think: boolean;
  boss: boolean;
  /** Gold Door follow-up: answer buttons (click, or keys 1-4). */
  gold?: { done: boolean; options: { label: string; state: 'idle' | 'right' | 'wrong' }[] };
}

export interface DetourPanel {
  questionId?: string;
  correct: string;
  explanation: string;
  workedExample: string;
  nearBoard: 'A' | 'B' | null;
  retryPrompt: string | null;
  retryFeedback: string | null;
}

export interface Settings {
  volume: number;
  muted: boolean;
  readAloud: boolean;
  reducedMotion: boolean;
  showMinimap: boolean;
  camSens: number;
  relaxedTimers: boolean;
  /** Last room of a solo run: the Slime Gate (default) or the Hex Finale. Online races ignore it. */
  finale: 'gate' | 'hex';
}

export interface Toast { id: number; text: string; tone: 'good' | 'bad' | 'info' }
export interface Banner { id: number; text: string; tone: 'good' | 'bad' | 'info' }

export interface HudState {
  slime: number; coins: number; elapsedMs: number; asked: number; correct: number; tier: Tier; zone: Zone;
  combo: number; speedPct: number;
  powerups: Record<PowerKind, number>;
  usable: Record<PowerKind, boolean>;
  freezeT: number; compassT: number; lantern: boolean; shield: boolean;
}

export interface UIState {
  screen: Screen;
  runId: number;
  selection: RunSelection | null;
  hud: HudState;
  room: RoomPanel | null;
  detour: DetourPanel | null;
  toasts: Toast[];
  banner: Banner | null;
  fade: boolean;
  paused: boolean;
  quickSelectOpen: boolean;
  /** The Gauntlet button opens Quick Select with the Gauntlet mode preselected. */
  quickSelectGauntlet: boolean;
  topicOpen: boolean;
  /** F3: the multiplayer lobby panel, and the "Leave race?" menu (online runs cannot pause). */
  lobbyOpen: boolean;
  leaveMenuOpen: boolean;
  hubPad: { domainId: DomainId; difficulty: Difficulty; progress: number } | null;
  results: RunResult | null;
  settings: Settings;
  isTouch: boolean;
  contentErrors: number;
  tip: string | null;
  lost: boolean;
  fiftyShake: number;
  hintShake: number;
  debugBoxes: boolean;
  avatar: AvatarConfig;
  /** null until the player has chosen a name (the one-time prompt then shows). */
  playerName: string | null;
  wardrobeOpen: boolean;
  namePromptOpen: boolean;
  /** Cosmetics unlocked by the run whose results are showing. */
  newUnlocks: CatalogItem[];
  /** F4-D: how the daily run that just ended compared with today's best (null for other runs). */
  dailyOutcome: DailyOutcome | null;
}

export const defaultSettings: Settings = DEFAULT_SETTINGS;

const NO_POWER = { lantern: 0, compass: 0, freeze: 0, xray: 0, shield: 0 };
const NOT_USABLE = { lantern: false, compass: false, freeze: false, xray: false, shield: false };
export const initialHud: HudState = {
  slime: 0, coins: 0, elapsedMs: 0, asked: 0, correct: 0, tier: 2, zone: 'normal',
  combo: 0, speedPct: 0, powerups: NO_POWER, usable: NOT_USABLE, freezeT: 0, compassT: 0, lantern: false, shield: false,
};

export const useUI = create<UIState>(() => ({
  screen: 'hub',
  runId: 0,
  selection: null,
  hud: initialHud,
  room: null,
  detour: null,
  toasts: [],
  banner: null,
  fade: false,
  paused: false,
  quickSelectOpen: false,
  quickSelectGauntlet: false,
  topicOpen: false,
  lobbyOpen: false,
  leaveMenuOpen: false,
  hubPad: null,
  results: null,
  settings: loadSave().settings,
  isTouch: typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(pointer: coarse)').matches : false,
  contentErrors: 0,
  tip: null,
  lost: false,
  fiftyShake: 0,
  hintShake: 0,
  debugBoxes: false,
  avatar: parseAvatarParam(params.avatar) ?? loadSave().avatar ?? DEFAULT_AVATAR,
  playerName: loadSave().playerName ?? null,
  wardrobeOpen: false,
  namePromptOpen: false,
  newUnlocks: [],
  dailyOutcome: null,
}));

let toastId = 1;
let bannerId = 1;
const toastTimers = new Map<number, ReturnType<typeof setTimeout>>();

export function pushToast(text: string, tone: Toast['tone'] = 'info', ms = 1600): void {
  const id = toastId++;
  useUI.setState((s) => ({ toasts: [...s.toasts.slice(-2), { id, text, tone }] }));
  toastTimers.set(id, setTimeout(() => {
    toastTimers.delete(id);
    useUI.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  }, ms));
}

let bannerTimer: ReturnType<typeof setTimeout> | null = null;
/** Show a centered banner. `ms = 0` keeps it until replaced/cleared. */
export function showBanner(text: string, tone: Banner['tone'] = 'info', ms = 1200): void {
  if (bannerTimer) clearTimeout(bannerTimer);
  const id = bannerId++;
  useUI.setState({ banner: { id, text, tone } });
  if (ms > 0) {
    bannerTimer = setTimeout(() => {
      bannerTimer = null;
      useUI.setState((s) => (s.banner && s.banner.id === id ? { banner: null } : s));
    }, ms);
  }
}

export function clearBanner(): void {
  if (bannerTimer) clearTimeout(bannerTimer);
  bannerTimer = null;
  useUI.setState({ banner: null });
}

export function clearToasts(): void {
  for (const t of toastTimers.values()) clearTimeout(t);
  toastTimers.clear();
  useUI.setState({ toasts: [] });
}
