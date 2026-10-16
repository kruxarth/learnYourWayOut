// Builds ../LearnYourWayOut_pitch.pptx (6 slides, format from fallguys/pptformat.md).
// Run from this folder:  NODE_PATH=<dir with pptxgenjs, react-icons, react, react-dom, sharp> PPTX_SKILL_DIR=<pptx skill> node build.cjs
// Screenshots: assets/raw (captured from the game) → `python bake.py` → assets/*.png. Fonts: fonts/ (Titan One, Nunito; OFL).
const path = require('path');
const fs = require('fs');
const pptxgen = require('pptxgenjs');
const sharp = require('sharp');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const fa = require('react-icons/fa');
const hi = require('react-icons/hi');
const gi = require('react-icons/gi');

const SKILL = process.env.PPTX_SKILL_DIR;
const { applyTheme } = require(path.join(SKILL, 'scripts/apply_theme.js'));

const HERE = __dirname;
const A = (f) => path.join(HERE, 'assets', f);
const META = JSON.parse(fs.readFileSync(A('meta.json'), 'utf8'));
const OUT = path.join(HERE, '..', 'LearnYourWayOut_pitch.pptx');

// Game palette (src/game/palette.ts, src/styles.css)
const HEX = {
  ink: '2B2D42', white: 'FFFFFF', muted: '5B5F80', paper: 'F1F9FF',
  pink: 'FF4FA0', sky: '6EC6FF', green: '3DBE6A', gold: 'FFC93C', purple: '7A4DFF', orange: 'FF8A3D',
  bean: 'FF7AB6', skyTop: '6EC6FF', skyHorizon: 'FFD9F0',
};
const TINT = { pink: 'FFE3F0', sky: 'DDF2FF', green: 'DDF6E5', gold: 'FFF3CF', purple: 'EAE2FF', orange: 'FFE8D8' };
const THEME = {
  name: 'Learn Your Way Out', headFontFace: 'Titan One', bodyFontFace: 'Nunito',
  colors: {
    dk1: HEX.ink, lt1: HEX.white, dk2: HEX.muted, lt2: HEX.paper,
    accent1: HEX.pink, accent2: HEX.sky, accent3: HEX.green, accent4: HEX.gold, accent5: HEX.purple, accent6: HEX.orange,
    hlink: HEX.purple, folHlink: HEX.muted,
  },
};
const HEAD = THEME.headFontFace;

const W = 13.333, H = 7.5, MX = 0.6, CONTENT_R = W - MX;

// ───────────────────────── generated art ─────────────────────────

function beanSvg(fill) {
  // The bean from public/favicon.svg, without its background tile.
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="18 8 28 48" width="280" height="480">
    <rect x="20" y="10" width="24" height="44" rx="12" fill="#${fill}"/>
    <ellipse cx="32" cy="50" rx="10" ry="2.4" fill="#000" opacity="0.08"/>
    <circle cx="27" cy="26" r="4" fill="#fff"/><circle cx="37" cy="26" r="4" fill="#fff"/>
    <circle cx="27.6" cy="27" r="2" fill="#2B2D42"/><circle cx="37.6" cy="27" r="2" fill="#2B2D42"/></svg>`;
}

function skySvg() {
  const cloud = (x, y, s, o) => `<g transform="translate(${x} ${y}) scale(${s})" opacity="${o}" fill="#fff">
    <ellipse cx="0" cy="0" rx="120" ry="44"/><ellipse cx="-70" cy="12" rx="70" ry="34"/><ellipse cx="78" cy="10" rx="80" ry="36"/>
    <ellipse cx="10" cy="-30" rx="70" ry="44"/></g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#${HEX.skyTop}"/><stop offset="0.72" stop-color="#BFE6FF"/><stop offset="1" stop-color="#${HEX.skyHorizon}"/></linearGradient></defs>
    <rect width="1920" height="1080" fill="url(#g)"/>
    ${cloud(260, 120, 1.0, 0.75)}${cloud(1010, 70, 0.7, 0.6)}${cloud(150, 960, 1.3, 0.55)}${cloud(1780, 1000, 1.1, 0.5)}
  </svg>`;
}

async function svgPng(svg, width) {
  const buf = await sharp(Buffer.from(svg)).resize({ width }).png().toBuffer();
  return 'image/png;base64,' + buf.toString('base64');
}

const iconCache = new Map();
async function icon(Comp, color, px = 256) {
  const key = `${Comp.name}|${color}`;
  if (!iconCache.has(key)) {
    const svg = renderToStaticMarkup(React.createElement(Comp, { color: '#' + color, size: px }));
    iconCache.set(key, await svgPng(svg, px));
  }
  return iconCache.get(key);
}

// ───────────────────────── helpers ─────────────────────────

const shadow = () => ({ type: 'outer', color: HEX.ink, opacity: 0.14, blur: 10, offset: 3, angle: 90 });

function card(s, x, y, w, h, o = {}) {
  s.addShape('roundRect', {
    x, y, w, h, rectRadius: o.r ?? 0.14, fill: { color: o.fill ?? HEX.white },
    line: o.line ? { color: o.line, width: o.lineW ?? 1.25 } : { type: 'none' },
    shadow: o.flat ? undefined : shadow(), objectName: o.name,
  });
}

function text(s, t, x, y, w, h, o = {}) {
  s.addText(t, {
    x, y, w, h, isTextBox: true, margin: o.margin ?? 0, fontSize: o.size ?? 14, color: o.color ?? HEX.ink,
    bold: o.bold, italic: o.italic, align: o.align ?? 'left', valign: o.valign ?? 'top', fontFace: o.font,
    charSpacing: o.cs, paraSpaceAfter: o.psa, lineSpacingMultiple: o.lsm, objectName: o.name, fit: 'none',
  });
}

function pill(s, t, x, y, w, h, fill, color, o = {}) {
  s.addText(t, {
    shape: 'roundRect', rectRadius: h / 2, x, y, w, h, fill: { color: fill }, line: o.line ? { color: o.line, width: 1 } : { type: 'none' },
    isTextBox: true, margin: 0, align: 'center', valign: 'middle', fontSize: o.size ?? 11, bold: o.bold ?? true, color,
    charSpacing: o.cs, objectName: o.name, shadow: o.shadow ? shadow() : undefined,
  });
}

function kicker(s, label) {
  const w = 0.42 + label.length * 0.118;
  pill(s, label, MX, 0.42, w, 0.32, HEX.pink, HEX.white, { size: 10.5, cs: 1.5, name: 'kicker' });
}

/** Place a baked screenshot so its visible card is w inches wide at (x, y). */
function shot(s, name, x, y, w, o = {}) {
  const m = META[name];
  const scale = w / m.cardW;
  const fw = m.w * scale, fh = m.h * scale, pad = m.pad * scale;
  s.addImage({ path: A(name + '.png'), x: x - pad, y: y - pad, w: fw, h: fh, rotate: o.rotate, altText: o.alt, objectName: name });
  return { h: m.cardH * scale };
}

async function iconCircle(s, Comp, x, y, d, fill, color) {
  s.addShape('ellipse', { x, y, w: d, h: d, fill: { color: fill }, line: { type: 'none' } });
  const p = d * 0.56;
  s.addImage({ data: await icon(Comp, color), x: x + (d - p) / 2, y: y + (d - p) / 2, w: p, h: p });
}

function arrow(s, x1, y1, x2, y2, color = HEX.muted, o = {}) {
  s.addShape('line', {
    x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.max(Math.abs(x2 - x1), 0.001), h: Math.max(Math.abs(y2 - y1), 0.001),
    flipH: x2 < x1, flipV: y2 < y1,
    line: { color, width: o.width ?? 1.75, endArrowType: o.end === false ? undefined : 'triangle', beginArrowType: o.both ? 'triangle' : undefined, dashType: o.dash },
  });
}

// ───────────────────────── deck ─────────────────────────

async function main() {
  const pres = new pptxgen();
  pres.layout = 'LAYOUT_WIDE';
  pres.title = 'Learn Your Way Out: PL05 pitch';
  pres.author = 'Team Solo';
  pres.subject = 'PL05 Learn Your Way Out, Play Lab track';
  pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace };
  const C = pres.SchemeColor;

  const skyBg = await svgPng(skySvg(), 1920);
  const beanPink = await svgPng(beanSvg(HEX.bean), 280);

  pres.defineSlideMaster({
    title: 'TITLE',
    background: { data: skyBg },
    objects: [
      { placeholder: { options: { name: 'title', type: 'title', x: MX + 0.1, y: 1.22, w: 6.2, h: 2.35, fontFace: HEAD, fontSize: 60, color: C.background1, align: 'left', valign: 'top', margin: 0 }, text: '' } },
    ],
  });
  pres.defineSlideMaster({
    title: 'CONTENT',
    background: { color: HEX.paper },
    margin: [0.5, 0.6, 0.6, 0.6],
    objects: [
      { placeholder: { options: { name: 'title', type: 'title', x: MX, y: 0.8, w: 12.1, h: 0.78, fontFace: HEAD, fontSize: 34, color: C.text1, align: 'left', valign: 'middle', margin: 0 }, text: '' } },
      { image: { data: beanPink, x: MX, y: 7.0, w: 0.15, h: 0.257 } },
      { text: { text: 'LEARN YOUR WAY OUT  ·  PL05  ·  PLAY LAB', options: { x: MX + 0.24, y: 7.02, w: 6, h: 0.24, fontSize: 9, bold: true, color: C.text2, charSpacing: 1.5, margin: 0, valign: 'middle' } } },
    ],
    slideNumber: { x: 12.23, y: 7.02, w: 0.5, h: 0.24, fontSize: 9, color: C.text2, align: 'right', bold: true },
  });

  // ═════════════ 1 · Intro ═════════════
  pres.addSection({ title: 'Intro' });
  {
    const s = pres.addSlide({ masterName: 'TITLE', sectionTitle: 'Intro' });
    pill(s, 'PL05  ·  PLAY LAB TRACK', MX + 0.1, 0.72, 2.75, 0.38, HEX.white, HEX.pink, { size: 11, cs: 1.5, shadow: true });
    pill(s, 'IDEATION PHASE', MX + 3.0, 0.72, 1.9, 0.38, HEX.gold, HEX.ink, { size: 11, cs: 1.5, shadow: true });
    s.addText('LEARN YOUR\nWAY OUT', { placeholder: 'title', outline: { size: 2, color: HEX.ink } });
    text(s, [
      { text: 'Every learning game is a quiz in a costume.', options: { breakLine: true } },
      { text: 'In ours, ', options: {} }, { text: 'the maze is the quiz.', options: { bold: true, color: HEX.pink } },
    ], MX + 0.1, 3.62, 6.1, 0.85, { size: 19, italic: true, lsm: 1.05 });

    const infos = [['TEAM', 'Solo', 1.2], ['PROJECT', 'PL05 – Learn Your Way Out', 3.3], ['TRACK', 'Play Lab', 1.4]];
    let x = MX + 0.1;
    for (const [label, value, w] of infos) {
      card(s, x, 4.72, w, 1.0, { r: 0.16 });
      text(s, label, x + 0.18, 4.86, w - 0.3, 0.22, { size: 10, bold: true, color: HEX.pink, cs: 1.5 });
      text(s, value, x + 0.18, 5.1, w - 0.3, 0.5, { size: 15, bold: true, valign: 'top' });
      x += w + 0.2;
    }
    const chips = ['3D browser game', 'AI custom questions', 'Live multiplayer', 'Adaptive difficulty'];
    chips.forEach((c, i) => {
      if (i % 2 === 0) x = MX + 0.1;
      const w = 0.42 + c.length * 0.095;
      pill(s, c, x, 5.96 + Math.floor(i / 2) * 0.48, w, 0.38, HEX.ink, HEX.white, { size: 11.5 });
      x += w + 0.14;
    });
    shot(s, 'hub', 7.85, 0.72, 4.85, { rotate: -4, alt: 'Game hub with domain portals and difficulty pads' });
    shot(s, 'doorrush', 7.4, 3.3, 5.3, { rotate: 2.5, alt: 'Door Rush room: run through the door with the right answer' });
    s.addImage({ data: beanPink, x: 4.85, y: 2.3, w: 0.66, h: 1.13, rotate: 10, altText: 'Bean mascot' });
    pill(s, 'EARLY CONCEPT PROTOTYPE', 7.6, 6.42, 2.35, 0.3, HEX.ink, HEX.white, { size: 9.5, cs: 1, shadow: true, name: 'prototype-label' });
    s.addNotes('Hi, I am Team Solo with PL05, Learn Your Way Out, for the Play Lab track. We are in the ideation phase. The idea is a 3D maze game in the browser where every answer is a place you run to: a door, a tile, a stepping stone. Players pick a subject and a difficulty, escape the maze, and learn on the way. We also plan AI-made questions on any topic and live races with friends.');
  }

  // ═════════════ 2 · Proposed solution ═════════════
  pres.addSection({ title: 'Proposed solution' });
  {
    const s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Proposed solution' });
    kicker(s, '02  ·  PROPOSED SOLUTION');
    s.addText('The maze is the quiz', { placeholder: 'title' });
    text(s, 'Most learning games pause the fun for a quiz popup. Here, every answer is a place you run to.', MX, 1.58, 12, 0.36, { size: 15, italic: true, color: HEX.muted });

    const feats = [
      [fa.FaRunning, 'pink', 'Answer with your feet', '5 room types turn every question type into movement.'],
      [fa.FaLightbulb, 'gold', 'Wrong turns teach', 'A detour shows the answer, why, a worked example, a retry.'],
      [fa.FaChartLine, 'green', 'Adapts to every player', 'Harder after 2 right, easier after a miss; replay weak spots.'],
      [hi.HiSparkles, 'purple', 'AI custom questions', 'Type a topic or paste notes; DeepSeek builds a live pack.'],
      [fa.FaUsers, 'sky', 'Live multiplayer races', 'Race friends through the same seeded maze as ghost beans.'],
      [gi.GiMaze, 'orange', 'A new maze every run', 'Seeded mazes with forks, dead ends, coins and rising slime.'],
    ];
    let y = 2.18;
    for (const [Ic, col, title, desc] of feats) {
      await iconCircle(s, Ic, MX, y + 0.02, 0.5, TINT[col], HEX[col] === HEX.gold ? 'D9A400' : HEX[col]);
      text(s, title, MX + 0.66, y, 4.6, 0.26, { size: 14, bold: true });
      text(s, desc, MX + 0.66, y + 0.28, 4.75, 0.26, { size: 11.5, color: HEX.muted });
      y += 0.64;
    }
    s.addText([
      { text: 'USP  ', options: { bold: true, color: HEX.gold } },
      { text: 'Answers are places, not buttons. Mistakes become lessons, not game-overs.', options: { bold: true } },
    ], { shape: 'roundRect', rectRadius: 0.14, x: MX, y: 6.08, w: 5.2, h: 0.72, fill: { color: HEX.ink }, line: { type: 'none' }, color: HEX.white, fontSize: 13.5, margin: [14, 14, 0, 0], valign: 'middle', isTextBox: true, objectName: 'usp' });

    const grid = [
      ['doorgrid', 'DOOR RUSH', 'multiple choice'], ['tiledrop', 'TILE DROP', 'true / false'],
      ['steps', 'STEP STONES', 'multi-step problems'], ['bridge', 'BRIDGE BUILDER', 'put in order'],
    ];
    const gw = 3.22, gx0 = CONTENT_R - (2 * gw + 0.25), gy0 = 2.12;
    grid.forEach(([name, title, kind], i) => {
      const x = gx0 + (i % 2) * (gw + 0.25), yy = gy0 + Math.floor(i / 2) * 2.36;
      const { h } = shot(s, name, x, yy, gw, { alt: `${title} room` });
      text(s, [{ text: title, options: { bold: true, color: HEX.pink } }, { text: '   ' + kind, options: { color: HEX.muted, bold: true } }],
        x + 0.05, yy + h + 0.07, gw, 0.26, { size: 11.5, cs: 0.5 });
    });
    pill(s, 'EARLY CONCEPT PROTOTYPE', CONTENT_R - 2.5, gy0 - 0.16, 2.35, 0.3, HEX.ink, HEX.white, { size: 9.5, cs: 1, shadow: true, name: 'prototype-label' });
    s.addNotes('The problem: most learning games are a quiz with a costume. Play stops, a popup asks a question, play resumes. Our idea is that the maze is the quiz. Door Rush is multiple choice: run through the right door. Tile Drop is true or false: stand on the right tile before time runs out. Step Stones solves a problem one step at a time. Bridge Builder puts things in order. A wrong answer drops you into a detour that teaches the answer and gives a retry, while the slime keeps rising. The screens are from an early concept prototype. On top, we plan AI-made questions on any topic and live multiplayer races.');
  }

  // ═════════════ 3 · Technical approach ═════════════
  pres.addSection({ title: 'Technical approach' });
  {
    const s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Technical approach' });
    kicker(s, '03  ·  TECHNICAL APPROACH');
    s.addText('One loop, from pick to escape', { placeholder: 'title' });

    // game loop flowchart (mirrors the brief)
    const nodeW = 1.5, gap = 0.25, rowY = 2.2, nodeH = 0.86;
    const nodes = [
      ['SELECT', 'domain + difficulty', 'sky'], ['GENERATE', 'seeded maze + rooms', 'sky'], ['NAVIGATE', '3D bean, minimap', 'sky'],
      ['CHALLENGE', 'room asks a question', 'gold'], ['EVALUATE', 'check, adapt tier', 'gold'],
    ];
    nodes.forEach(([t, d, col], i) => {
      const x = MX + i * (nodeW + gap);
      card(s, x, rowY, nodeW, nodeH, { fill: TINT[col], r: 0.12, flat: true, line: HEX[col] === HEX.gold ? 'E8B21E' : '4DB2F0' });
      text(s, t, x + 0.1, rowY + 0.12, nodeW - 0.2, 0.26, { size: 12, bold: true, align: 'center' });
      text(s, d, x + 0.08, rowY + 0.42, nodeW - 0.16, 0.36, { size: 10.5, color: HEX.muted, align: 'center' });
      pill(s, String(i + 1), x - 0.1, rowY - 0.13, 0.3, 0.3, HEX.ink, HEX.white, { size: 10.5 });
      if (i < nodes.length - 1) arrow(s, x + nodeW + 0.03, rowY + nodeH / 2, x + nodeW + gap - 0.03, rowY + nodeH / 2);
    });
    const evalR = MX + 4 * (nodeW + gap) + nodeW, midY = rowY + nodeH / 2;
    const bx = evalR + 0.45, bw = 1.45, bh = 0.78;
    const branches = [['PROGRESS', 'door opens, slime drops', 'green', 1.72, '✓'], ['DETOUR', 'explain, example, retry', 'pink', 2.94, '✗']];
    for (const [t, d, col, y, mark] of branches) {
      card(s, bx, y, bw, bh, { fill: TINT[col], r: 0.12, flat: true, line: HEX[col] });
      text(s, t, bx + 0.08, y + 0.1, bw - 0.16, 0.26, { size: 12, bold: true, align: 'center' });
      text(s, d, bx + 0.08, y + 0.38, bw - 0.16, 0.34, { size: 10.5, color: HEX.muted, align: 'center' });
      arrow(s, evalR + 0.03, midY, bx - 0.03, y + bh / 2, HEX[col]);
      text(s, mark, evalR + 0.1, (midY + y + bh / 2) / 2 - (mark === '✓' ? 0.3 : 0.02), 0.3, 0.28, { size: 13, bold: true, color: HEX[col] });
    }
    const ox = bx + bw + 0.35, ow = CONTENT_R - ox;
    card(s, ox, rowY - 0.08, ow, nodeH + 0.16, { fill: HEX.ink, r: 0.12, flat: true });
    text(s, 'WIN / LOSE', ox + 0.08, rowY + 0.06, ow - 0.16, 0.26, { size: 12, bold: true, color: HEX.white, align: 'center' });
    text(s, 'portal = qualified\nslime 100% = out', ox + 0.08, rowY + 0.36, ow - 0.16, 0.44, { size: 10.5, color: 'D6D8EA', align: 'center' });
    for (const [, , col, y] of branches) arrow(s, bx + bw + 0.03, y + bh / 2, ox - 0.03, midY, HEX.muted);
    // loop back: outcome → navigate
    const loopY = 3.98, navX = MX + 2 * (nodeW + gap) + nodeW / 2, oxC = ox + ow / 2;
    arrow(s, oxC, rowY + nodeH + 0.08, oxC, loopY, HEX.muted, { end: false, dash: 'dash' });
    arrow(s, oxC, loopY, navX, loopY, HEX.muted, { end: false, dash: 'dash' });
    arrow(s, navX, loopY, navX, rowY + nodeH + 0.03, HEX.muted, { dash: 'dash' });
    text(s, 'not finished? back into the maze, next room', navX + 0.2, loopY - 0.3, 4.2, 0.24, { size: 10.5, italic: true, color: HEX.muted });

    // architecture
    const ay = 4.3, ah = 2.55;
    card(s, MX, ay, 4.75, ah, { r: 0.14 });
    text(s, 'PLANNED BROWSER CLIENT', MX + 0.2, ay + 0.14, 4, 0.22, { size: 10, bold: true, color: HEX.pink, cs: 1.5 });
    const layers = [
      ['UI', 'React DOM + zustand: HUD, menus, results', 'pink'],
      ['Render', 'three.js + React Three Fiber', 'purple'],
      ['Engine', 'TypeScript, fixed 120 Hz step, own collision', 'sky'],
      ['Content', 'JSON packs + validator, QuestionSource', 'green'],
    ];
    layers.forEach(([t, d, col], i) => {
      const y = ay + 0.48 + i * 0.5;
      s.addText([{ text: t + '   ', options: { bold: true } }, { text: d, options: { color: HEX.muted } }], {
        shape: 'roundRect', rectRadius: 0.08, x: MX + 0.2, y, w: 4.35, h: 0.42, fill: { color: TINT[col] }, line: { type: 'none' },
        fontSize: 11, color: HEX.ink, margin: [10, 10, 0, 0], valign: 'middle', isTextBox: true,
      });
    });
    const sx = MX + 5.15, sw = 2.15;
    const services = [['AI QUESTIONS', 'Node proxy → DeepSeek API, key stays on server', 'purple', ay], ['MULTIPLAYER', 'WebSocket relay: shared seed + positions 10/s', 'sky', ay + 1.34]];
    for (const [t, d, col, y] of services) {
      card(s, sx, y, sw, 1.21, { r: 0.14 });
      text(s, t, sx + 0.16, y + 0.13, sw - 0.3, 0.22, { size: 10, bold: true, color: HEX[col] === HEX.sky ? '2E8FD6' : HEX[col], cs: 1.5 });
      text(s, d, sx + 0.16, y + 0.38, sw - 0.3, 0.76, { size: 11, color: HEX.ink });
      arrow(s, MX + 4.78, y + 0.6, sx - 0.04, y + 0.6, HEX.muted, { both: true });
    }

    // key techniques
    const kx = sx + sw + 0.4, kw = CONTENT_R - kx;
    const techs = [
      [gi.GiMaze, 'orange', 'Maze', 'DFS backtracker + braiding on a seeded PRNG: one seed, one identical maze.'],
      [fa.FaChartLine, 'green', 'Adaptive picker', 'tier staircase, scored by recency and weak concepts.'],
      [hi.HiSparkles, 'purple', 'AI pipeline', 'JSON schema → validator → cached pack; built-in bank as fallback.'],
      [fa.FaUsers, 'sky', 'Multiplayer', 'share the seed, stream positions; each client runs its own course.'],
      [fa.FaVial, 'pink', 'Test plan', 'a headless bot plays every generated course before release.'],
    ];
    for (let i = 0; i < techs.length; i++) {
      const [Ic, col, t, d] = techs[i];
      const y = ay + i * 0.52;
      await iconCircle(s, Ic, kx, y + 0.03, 0.36, TINT[col], HEX[col]);
      text(s, [{ text: t + ': ', options: { bold: true } }, { text: d, options: { color: HEX.muted } }], kx + 0.48, y, kw - 0.48, 0.5, { size: 11.5, valign: 'top' });
    }
    s.addNotes('This is the loop from the brief: select, generate, navigate, challenge, evaluate, then progress or penalty, and a win or lose check. The planned engine is plain TypeScript with a fixed 120 Hz step and its own collision, so it can run headless and a bot can play every generated course as a test. Rendering will use three.js through React Three Fiber, and the HUD React with zustand. Mazes come from a depth-first backtracker with braiding, seeded so one seed always gives the same maze. AI questions will go through a small Node proxy to DeepSeek, be validated against our question schema, and be cached. Multiplayer only needs to share the seed and positions, because every client can build the same course itself.');
  }

  // ═════════════ 4 · Feasibility & viability ═════════════
  pres.addSection({ title: 'Feasibility & viability' });
  {
    const s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Feasibility & viability' });
    kicker(s, '04  ·  FEASIBILITY & VIABILITY');
    s.addText('Feasible, low-cost, low-risk', { placeholder: 'title' });

    const stats = [
      ['4', 'domains at launch: math, science, history, programming', 'pink'],
      ['5', 'room types, one for each question format', 'purple'],
      ['3', 'difficulty levels, plus adaptive tiers', 'green'],
      ['0', 'installs: runs on laptops and phones from a link', 'orange'],
    ];
    const tw = (CONTENT_R - MX - 3 * 0.25) / 4;
    stats.forEach(([n, l, col], i) => {
      const x = MX + i * (tw + 0.25);
      card(s, x, 1.8, tw, 1.08, { r: 0.16 });
      text(s, n, x + 0.22, 1.86, tw - 0.4, 0.58, { size: 32, font: HEAD, color: HEX[col], valign: 'middle' });
      text(s, l, x + 0.22, 2.42, tw - 0.4, 0.42, { size: 11, color: HEX.muted });
    });

    // roadmap
    const by = 3.12, bh = 3.73;
    card(s, MX, by, 4.35, bh, { r: 0.16 });
    text(s, 'ROADMAP', MX + 0.22, by + 0.2, 3, 0.22, { size: 10, bold: true, color: '2E8FD6', cs: 1.5 });
    const phases = [
      ['Concept & design', 'brief, mechanics, architecture', true],
      ['Core prototype', 'maze, 5 rooms, detour, slime'],
      ['Content & adaptivity', 'question packs, tiers, weak spots'],
      ['AI custom questions', 'DeepSeek packs from topics or notes'],
      ['Multiplayer & pilot', 'live races, a classroom trial'],
    ];
    const lx = MX + 0.42, y0 = by + 0.72, step = 0.62;
    arrow(s, lx, y0, lx, y0 + step * (phases.length - 1), 'C9D3E3', { end: false, width: 2 });
    phases.forEach(([t, d, now], i) => {
      const y = y0 + i * step;
      s.addShape('ellipse', { x: lx - 0.12, y: y - 0.12, w: 0.24, h: 0.24, fill: { color: now ? HEX.pink : HEX.white }, line: { color: now ? HEX.pink : 'A3A7C2', width: 1.5 } });
      text(s, t, lx + 0.3, y - 0.2, 2.25, 0.26, { size: 12.5, bold: true });
      text(s, d, lx + 0.3, y + 0.06, 3.4, 0.24, { size: 10.5, color: HEX.muted });
      if (now) pill(s, 'WE ARE HERE', MX + 2.95, y - 0.17, 1.2, 0.28, HEX.pink, HEX.white, { size: 9, cs: 1 });
    });

    // feasibility + viability
    const fx = MX + 4.6, fw = 4.05;
    card(s, fx, by, fw, bh, { r: 0.16 });
    const groups = [
      ['FEASIBILITY', 'pink', [
        [fa.FaCubes, 'Proven web stack: three.js + React'],
        [fa.FaMobileAlt, 'Pure browser, touch for phones'],
        [fa.FaLayerGroup, 'Modular: AI + multiplayer plug in'],
      ]],
      ['VIABILITY', 'green', [
        [fa.FaGlobe, 'Core is static files: free hosting'],
        [hi.HiSparkles, 'One AI call = one cached pack'],
        [fa.FaServer, 'Relay forwards positions only'],
      ]],
    ];
    let gy = by + 0.2;
    for (const [label, col, rows] of groups) {
      text(s, label, fx + 0.22, gy, 3, 0.22, { size: 10, bold: true, color: HEX[col], cs: 1.5 });
      gy += 0.32;
      for (const [Ic, t] of rows) {
        await iconCircle(s, Ic, fx + 0.22, gy, 0.34, TINT[col], HEX[col]);
        text(s, t, fx + 0.68, gy, fw - 0.85, 0.34, { size: 12.5, valign: 'middle' });
        gy += 0.46;
      }
      gy += 0.16;
    }

    // risks → mitigations
    const rx = fx + fw + 0.25, rw = CONTENT_R - rx;
    card(s, rx, by, rw, bh, { r: 0.16 });
    text(s, 'RISKS  →  MITIGATIONS', rx + 0.2, by + 0.2, rw - 0.3, 0.22, { size: 10, bold: true, color: HEX.purple, cs: 1.5 });
    const risks = [
      ['Wrong AI facts', 'schema validator, second-pass check, teacher review'],
      ['AI latency', 'generate in the hub before the run; built-in bank fallback'],
      ['Leaked API key', 'key stays on a server proxy, never in the browser'],
      ['Lag in races', 'each client simulates locally; ghosts interpolate'],
    ];
    risks.forEach(([r, m], i) => {
      const y = by + 0.58 + i * 0.78;
      text(s, r, rx + 0.2, y, rw - 0.35, 0.24, { size: 12, bold: true });
      text(s, m, rx + 0.2, y + 0.25, rw - 0.35, 0.44, { size: 11, color: HEX.muted });
    });
    s.addNotes('Feasibility: every part uses proven web technology that runs in any browser, including phones, and the design is modular, so AI questions and multiplayer plug in later. Viability: the core is static files, so hosting is free tier. AI generation makes a whole question pack per call and caches it, and the multiplayer relay only forwards positions, so servers stay tiny. The roadmap goes from concept, where we are now, to a core prototype, then content and adaptivity, AI questions, and finally multiplayer and a classroom pilot. The main risks are wrong AI facts and latency; we plan schema validation, a second check and a built-in question bank as fallback.');
  }

  // ═════════════ 5 · Impact & benefits ═════════════
  pres.addSection({ title: 'Impact & benefits' });
  {
    const s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Impact & benefits' });
    kicker(s, '05  ·  IMPACT & BENEFITS');
    s.addText('Mistakes become lessons', { placeholder: 'title' });

    const rw = 3.85;
    const { h } = shot(s, 'results', MX, 1.82, rw, { alt: 'Results card with mastery per concept and a review of missed questions' });
    pill(s, 'EARLY CONCEPT PROTOTYPE', MX + rw - 2.5, 1.82 - 0.16, 2.35, 0.3, HEX.ink, HEX.white, { size: 9.5, cs: 1, shadow: true, name: 'prototype-label' });
    text(s, 'Planned: every run ends with mastery per concept and a review of every miss.', MX, 1.82 + h + 0.1, rw, 0.42, { size: 11, italic: true, color: HEX.muted });

    // learning loop
    const cx = 6.94, cy = 4.35, rx = 1.5, ry = 1.72, nw = 1.42, nh = 0.8;
    const loop = [
      ['TRY', 'answer in the maze', 'sky'], ['FEEDBACK', 'instant ✓ or ✗', 'gold'], ['EXPLAIN', 'answer + worked example', 'pink'],
      ['RETRY', 'a similar question', 'purple'], ['ADAPT', 'tier + weak spots', 'green'],
    ];
    const pts = loop.map((_, i) => { const a = (-90 + i * 72) * Math.PI / 180; return { x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) }; });
    for (let i = 0; i < 5; i++) {
      const p = pts[i], q = pts[(i + 1) % 5];
      const dx = q.x - p.x, dy = q.y - p.y, len = Math.hypot(dx, dy), ux = dx / len, uy = dy / len;
      const edge = Math.min((nw / 2 + 0.07) / Math.abs(ux || 1e-9), (nh / 2 + 0.07) / Math.abs(uy || 1e-9));
      arrow(s, p.x + ux * edge, p.y + uy * edge, q.x - ux * edge, q.y - uy * edge, 'A3A7C2', { width: 2 });
    }
    loop.forEach(([t, d, col], i) => {
      const p = pts[i];
      card(s, p.x - nw / 2, p.y - nh / 2, nw, nh, { fill: TINT[col], r: 0.14, line: HEX[col] === HEX.gold ? 'E8B21E' : HEX[col], flat: true });
      text(s, t, p.x - nw / 2, p.y - nh / 2 + 0.09, nw, 0.26, { size: 12, bold: true, align: 'center' });
      text(s, d, p.x - nw / 2 + 0.06, p.y - nh / 2 + 0.36, nw - 0.12, 0.4, { size: 10, color: HEX.muted, align: 'center' });
    });
    s.addImage({ data: beanPink, x: cx - 0.24, y: cy - 0.55, w: 0.48, h: 0.82, altText: 'Bean mascot' });
    text(s, 'THE LEARNING LOOP', cx - 1, cy + 0.32, 2, 0.24, { size: 10, bold: true, color: HEX.pink, align: 'center', cs: 1.5 });

    // audiences
    const ax = 9.42, aw = CONTENT_R - ax, ah = 1.5;
    const aud = [
      [fa.FaUserGraduate, 'pink', 'Students', 'Active recall in every room, safe low-stakes mistakes, and races with friends.'],
      [fa.FaChalkboardTeacher, 'purple', 'Teachers', 'Questions from your own notes in seconds, plus a weak-spot report per concept.'],
      [fa.FaSchool, 'green', 'Schools', 'No installs, runs on old laptops and phones; read-aloud, reduced motion, touch.'],
    ];
    for (let i = 0; i < aud.length; i++) {
      const [Ic, col, t, d] = aud[i];
      const y = 1.82 + i * (ah + 0.18);
      card(s, ax, y, aw, ah, { r: 0.16 });
      await iconCircle(s, Ic, ax + 0.2, y + 0.2, 0.46, TINT[col], HEX[col]);
      text(s, t, ax + 0.8, y + 0.26, aw - 1, 0.34, { size: 15, bold: true, valign: 'middle' });
      text(s, d, ax + 0.2, y + 0.78, aw - 0.38, 0.64, { size: 11.5, color: HEX.muted });
    }
    s.addNotes('The impact is in the loop. You try by moving, you get instant feedback, a wrong answer explains itself with a worked example, you retry a similar question, and the game adapts. Each run is designed to end with mastery per concept and a review of every miss, with one button to replay weak spots. Students get active recall and safe mistakes, teachers can turn their own notes into a game in seconds, and schools need nothing but a browser.');
  }

  // ═════════════ 6 · Research & references ═════════════
  pres.addSection({ title: 'Research & references' });
  {
    const s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Research & references' });
    kicker(s, '06  ·  RESEARCH & REFERENCES');
    s.addText('Grounded in learning science', { placeholder: 'title' });

    const rows = [
      ['Testing effect', 'Roediger & Karpicke, 2006', 'Every room is a retrieval attempt, answered by moving', 'sky'],
      ['Feedback', 'Hattie & Timperley, 2007', 'Instant ✓ or ✗ on the door, tile or step you chose', 'gold'],
      ['Learning from errors', 'Metcalfe, 2017', 'A wrong answer opens a detour: answer, why, worked example, retry', 'pink'],
      ['Desirable difficulty & flow', 'Bjork & Bjork, 2011; Csikszentmihalyi, 1990', 'The adaptive tier keeps the challenge just above skill', 'purple'],
      ['Spacing', 'Cepeda et al., 2006', 'Weak-spot runs bring missed concepts back later', 'green'],
      ['Games that teach', 'Wouters et al., 2013; Clark et al., 2016', 'The learning is the core mechanic, not a popup', 'orange'],
    ];
    text(s, 'RESEARCH SAYS', MX, 1.78, 3.4, 0.22, { size: 10, bold: true, color: HEX.muted, cs: 1.5 });
    text(s, 'SO THE GAME DOES', MX + 3.9, 1.78, 3.6, 0.22, { size: 10, bold: true, color: HEX.muted, cs: 1.5 });
    rows.forEach(([f, cite, mech, col], i) => {
      const y = 2.1 + i * 0.79, rh = 0.66;
      card(s, MX, y, 3.4, rh, { fill: TINT[col], r: 0.12, flat: true });
      text(s, f, MX + 0.16, y + 0.08, 3.1, 0.26, { size: 12.5, bold: true });
      text(s, cite, MX + 0.16, y + 0.35, 3.1, 0.24, { size: 10, color: HEX.muted, italic: true });
      arrow(s, MX + 3.46, y + rh / 2, MX + 3.84, y + rh / 2, HEX[col] === HEX.gold ? 'E8B21E' : HEX[col], { width: 2 });
      card(s, MX + 3.9, y, 3.75, rh, { r: 0.12 });
      text(s, mech, MX + 4.06, y, 3.48, rh, { size: 12, valign: 'middle' });
    });

    const fx = MX + 8.0, fw = CONTENT_R - fx;
    card(s, fx, 1.78, fw, 5.07, { r: 0.16 });
    text(s, 'REFERENCES', fx + 0.22, 1.95, 3, 0.22, { size: 10, bold: true, color: HEX.pink, cs: 1.5 });
    const refs = [
      'Roediger & Karpicke (2006). Test-enhanced learning. Psychological Science, 17(3).',
      'Hattie & Timperley (2007). The power of feedback. Review of Educational Research, 77(1).',
      'Metcalfe (2017). Learning from errors. Annual Review of Psychology, 68.',
      'Bjork & Bjork (2011). Making things hard on yourself, but in a good way. Psychology and the Real World.',
      'Csikszentmihalyi (1990). Flow: The Psychology of Optimal Experience.',
      'Cepeda et al. (2006). Distributed practice in verbal recall tasks. Psychological Bulletin, 132(3).',
      'Wouters et al. (2013). Cognitive and motivational effects of serious games. J. Educational Psychology, 105(2).',
      'Clark, Tanner-Smith & Killingsworth (2016). Digital games, design, and learning. Review of Educational Research, 86(1).',
      'Buck (2015). Mazes for Programmers. Pragmatic Bookshelf.',
      'Fiedler (2004). Fix Your Timestep! gafferongames.com.',
      'Docs: three.js, React Three Fiber, DeepSeek API. Art direction: Fall Guys (Mediatonic, 2020).',
    ];
    s.addText(refs.flatMap((r, i) => [{ text: `${i + 1}  `, options: { bold: true, color: HEX.pink } }, { text: r, options: { breakLine: i < refs.length - 1 } }]), {
      x: fx + 0.2, y: 2.25, w: fw - 0.36, h: 4.5, isTextBox: true, margin: 0, fontSize: 10, color: HEX.ink, valign: 'top', paraSpaceAfter: 4, fit: 'none',
    });
    s.addNotes('Each mechanic comes from a research result. Retrieval practice beats rereading, so every room is a retrieval attempt. Feedback is one of the strongest levers, so every answer gets instant feedback. Errors followed by corrective feedback help learning, which is the detour. Desirable difficulty and flow motivate the adaptive tier, spacing motivates weak-spot runs, and meta-analyses show games teach best when learning is part of the core mechanic.');
  }

  await pres.writeFile({ fileName: OUT });
  await applyTheme(OUT, THEME);
  console.log('wrote', OUT);
}

main().catch((e) => { console.error(e); process.exit(1); });
