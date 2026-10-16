import { CanvasTexture, SRGBColorSpace } from 'three';

export interface LabelOpts {
  text: string;
  w?: number; h?: number;
  bg?: string; fg?: string; border?: string;
  radius?: number; maxLines?: number;
}

const FONT = '"Nunito", "Baloo 2", ui-rounded, "Arial Rounded MT Bold", "Trebuchet MS", system-ui, sans-serif';
const cache = new Map<string, CanvasTexture>();

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Greedy word wrap. Returns null when a single word is wider than the box. */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] | null {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const word of words) {
    if (ctx.measureText(word).width > maxW) return null;
    const next = cur ? `${cur} ${word}` : word;
    if (ctx.measureText(next).width <= maxW) cur = next;
    else { lines.push(cur); cur = word; }
  }
  if (cur) lines.push(cur);
  return lines;
}

/** Draw text fitted into a rounded card (spec §17.6). Cached by all options. */
export function labelTexture(o: LabelOpts): CanvasTexture {
  const w = o.w ?? 512, h = o.h ?? 256;
  const bg = o.bg ?? '#FFFFFF', fg = o.fg ?? '#2B2D42', border = o.border ?? '#FF8A3D';
  const radius = o.radius ?? 36, maxLines = o.maxLines ?? 2;
  const text = o.text.replace(/`/g, '');
  const key = JSON.stringify([text, w, h, bg, fg, border, radius, maxLines]);
  const hit = cache.get(key);
  if (hit) return hit;

  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = bg;
  roundRect(ctx, 5, 5, w - 10, h - 10, radius);
  ctx.fill();
  ctx.lineWidth = 10;
  ctx.strokeStyle = border;
  ctx.stroke();

  const pad = 30;
  let size = 120;
  let lines: string[] = [text];
  for (;;) {
    ctx.font = `800 ${size}px ${FONT}`;
    const l = wrap(ctx, text, w - pad * 2);
    if (l && l.length <= maxLines && l.length * size * 1.15 <= h - pad * 2) { lines = l; break; }
    if (size <= 28) { lines = l ?? [text]; break; }
    size -= 6;
  }
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lineH = size * 1.15;
  const top = h / 2 - ((lines.length - 1) * lineH) / 2;
  lines.forEach((ln, i) => ctx.fillText(ln, w / 2, top + i * lineH, w - pad));

  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  cache.set(key, tex);
  return tex;
}

/** A sign board: big title over a smaller subtitle. */
export function signTexture(title: string, subtitle: string, bg = '#FFFFFF', border = '#FF8A3D', fg = '#2B2D42'): CanvasTexture {
  const w = 1024, h = 512;
  const key = JSON.stringify(['sign', title, subtitle, bg, border, fg]);
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = bg;
  roundRect(ctx, 6, 6, w - 12, h - 12, 56);
  ctx.fill();
  ctx.lineWidth = 14;
  ctx.strokeStyle = border;
  ctx.stroke();
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let ts = 150;
  ctx.font = `900 ${ts}px ${FONT}`;
  while (ctx.measureText(title).width > w - 100 && ts > 40) { ts -= 6; ctx.font = `900 ${ts}px ${FONT}`; }
  ctx.fillText(title, w / 2, subtitle ? h * 0.38 : h / 2);
  if (subtitle) {
    let ss = 78;
    ctx.font = `700 ${ss}px ${FONT}`;
    while (ctx.measureText(subtitle).width > w - 100 && ss > 24) { ss -= 4; ctx.font = `700 ${ss}px ${FONT}`; }
    ctx.fillStyle = '#5A5D7A';
    ctx.fillText(subtitle, w / 2, h * 0.72);
  }
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  cache.set(key, tex);
  return tex;
}

/** A long-text board (detour): a title line and a wrapped body that shrinks to fit. */
export function boardTexture(title: string, body: string, bg = '#FFFFFF', border = '#9B7BFF', titleColor = '#7A4DFF'): CanvasTexture {
  const w = 1024, h = 512;
  const text = body.replace(/`/g, '');
  const key = JSON.stringify(['board', title, text, bg, border, titleColor]);
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = bg;
  roundRect(ctx, 6, 6, w - 12, h - 12, 48);
  ctx.fill();
  ctx.lineWidth = 14;
  ctx.strokeStyle = border;
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = titleColor;
  ctx.font = `900 84px ${FONT}`;
  ctx.fillText(title, w / 2, 76);
  const padX = 56, top = 140, bottom = h - 40;
  let size = 64;
  let lines: string[] = [text];
  for (;;) {
    ctx.font = `800 ${size}px ${FONT}`;
    const l = wrap(ctx, text, w - padX * 2);
    if (l && l.length * size * 1.18 <= bottom - top) { lines = l; break; }
    if (size <= 26) { lines = l ?? [text]; break; }
    size -= 3;
  }
  ctx.fillStyle = '#2B2D42';
  const lineH = size * 1.18;
  const mid = (top + bottom) / 2;
  const first = mid - ((lines.length - 1) * lineH) / 2;
  lines.forEach((ln, i) => ctx.fillText(ln, w / 2, first + i * lineH, w - padX));
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  cache.set(key, tex);
  return tex;
}

/** Dispose every cached texture (call when a run ends). */
export function disposeLabels(): void {
  for (const t of cache.values()) t.dispose();
  cache.clear();
}

/** Dispose one cached texture (e.g. a name tag when its player leaves). */
export function releaseLabel(tex: CanvasTexture): void {
  for (const [k, v] of cache) if (v === tex) cache.delete(k);
  tex.dispose();
}
