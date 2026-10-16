import { T } from './tuning';

export interface InputState {
  moveX: number;  // −1..1, +1 = right
  moveY: number;  // −1..1, +1 = forward
  jumpPressed: boolean;
  fiftyPressed: boolean;
  hintPressed: boolean;
  dropPressed: boolean;
  pausePressed: boolean;
  readPressed: boolean;
  mutePressed: boolean;
  quickSelectPressed: boolean;
  yawDelta: number;  // radians, consumed each poll
  keys: string[];    // codes pressed (edge) since the last poll — used by debug keys
}

const state: InputState = {
  moveX: 0, moveY: 0, jumpPressed: false, fiftyPressed: false, hintPressed: false, dropPressed: false,
  pausePressed: false, readPressed: false, mutePressed: false, quickSelectPressed: false, yawDelta: 0, keys: [],
};

const held = new Set<string>();
let edges = {
  jump: false, fifty: false, hint: false, drop: false, pause: false, read: false, mute: false, quick: false,
};
let keyEdges: string[] = [];
let yawAccum = 0;
let dragging = false;
let lastX = 0;
let touchMove = { x: 0, y: 0 };
let inited = false;
let sens = 1;

/** When true, game keys are ignored and not prevented (menus use the keyboard). */
let blocked = false;

const PREVENT = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab']);

/** Keys typed into a text field must not move the bean (the Topic panel has one). */
function typingTarget(t: EventTarget | null): boolean {
  const el = t as { tagName?: string; isContentEditable?: boolean } | null;
  const tag = el?.tagName?.toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable === true;
}

function onKeyDown(e: KeyboardEvent): void {
  // typing in a text field (player name, topic) must not trigger game keys; Esc still closes panels
  if (e.code !== 'Escape' && typingTarget(e.target)) return;
  if (e.code === 'Escape' || e.code === 'KeyP') {
    if (!e.repeat) { edges.pause = true; keyEdges.push(e.code); }
    return;
  }
  if (blocked) return; // menus use the keyboard (Tab, arrows, Enter)
  if (PREVENT.has(e.code)) e.preventDefault();
  if (e.repeat) return;
  held.add(e.code);
  keyEdges.push(e.code);
  switch (e.code) {
    case 'Space': edges.jump = true; break;
    case 'KeyQ': edges.fifty = true; break;
    case 'KeyE': edges.hint = true; break;
    case 'KeyF': edges.drop = true; break;
    case 'KeyR': edges.read = true; break;
    case 'KeyM': edges.mute = true; break;
    case 'Tab': edges.quick = true; break;
  }
}
function onKeyUp(e: KeyboardEvent): void { if (!typingTarget(e.target)) held.delete(e.code); }
function onBlur(): void { held.clear(); dragging = false; touchMove = { x: 0, y: 0 }; }

function onPointerDown(e: PointerEvent): void {
  if (!(e.target instanceof HTMLCanvasElement)) return;
  if (e.pointerType === 'touch') return; // touch uses the joystick; camera yaw stays 0
  dragging = true;
  lastX = e.clientX;
}
function onPointerMove(e: PointerEvent): void {
  if (!dragging) return;
  const dx = e.clientX - lastX;
  lastX = e.clientX;
  yawAccum += -dx * T.CAM_YAW_SENS * sens;
}
function onPointerUp(): void { dragging = false; }

export const input = {
  init(): void {
    if (inited || typeof window === 'undefined') return;
    inited = true;
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  },
  setBlocked(b: boolean): void { blocked = b; if (b) held.clear(); },
  setSensitivity(s: number): void { sens = s; },
  /** Touch controls feed these. */
  setTouchMove(x: number, y: number): void { touchMove = { x, y }; },
  press(kind: 'jump' | 'fifty' | 'hint' | 'drop' | 'pause' | 'read' | 'mute' | 'quick'): void { edges[kind] = true; },
  clear(): void { held.clear(); edges = { jump: false, fifty: false, hint: false, drop: false, pause: false, read: false, mute: false, quick: false }; keyEdges = []; yawAccum = 0; },

  /** Build the InputState for this frame and consume edge flags. Returns a shared object. */
  poll(): InputState {
    let mx = 0, my = 0;
    if (held.has('KeyW') || held.has('ArrowUp')) my += 1;
    if (held.has('KeyS') || held.has('ArrowDown')) my -= 1;
    if (held.has('KeyD') || held.has('ArrowRight')) mx += 1;
    if (held.has('KeyA') || held.has('ArrowLeft')) mx -= 1;
    mx += touchMove.x; my += touchMove.y;
    const len = Math.hypot(mx, my);
    if (len > 1) { mx /= len; my /= len; }
    state.moveX = mx; state.moveY = my;
    state.jumpPressed = edges.jump; state.fiftyPressed = edges.fifty; state.hintPressed = edges.hint;
    state.dropPressed = edges.drop; state.pausePressed = edges.pause; state.readPressed = edges.read;
    state.mutePressed = edges.mute; state.quickSelectPressed = edges.quick;
    state.yawDelta = yawAccum;
    state.keys = keyEdges;
    edges = { jump: false, fifty: false, hint: false, drop: false, pause: false, read: false, mute: false, quick: false };
    keyEdges = [];
    yawAccum = 0;
    return state;
  },
};
