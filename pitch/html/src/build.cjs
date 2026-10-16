// Builds ../index.html: the "Game Arena" frontend-slides deck (6 slides, fixed 1920×1080 stage).
// Run: NODE_PATH=<dir with react, react-dom, react-icons> node build.cjs <path to frontend-slides viewport-base.css>
// The output is a single self-contained HTML file; images load from ../assets/.
const fs = require('fs');
const path = require('path');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const fa = require('react-icons/fa');
const hi = require('react-icons/hi');
const gi = require('react-icons/gi');

const BASE_CSS = fs.readFileSync(process.argv[2], 'utf8');
const OUT = path.join(__dirname, '..', 'index.html');
const ic = (C) => renderToStaticMarkup(React.createElement(C, { size: '1em', 'aria-hidden': true }));

const BEAN = `<svg viewBox="18 8 28 48" class="bean" aria-hidden="true"><rect x="20" y="10" width="24" height="44" rx="12" fill="#FF7AB6"/>
<circle cx="27" cy="26" r="4" fill="#fff"/><circle cx="37" cy="26" r="4" fill="#fff"/><circle cx="27.6" cy="27" r="2" fill="#2B2D42"/><circle cx="37.6" cy="27" r="2" fill="#2B2D42"/></svg>`;

/** Rising slime footer: grows a little on every slide (the deck's progress bar). */
const slime = (i, total) => `<div class="slime" style="--h:${58 + i * 7}px"><span>LEARN YOUR WAY OUT · PL05 · PLAY LAB</span><span>${i} / ${total}</span></div>`;
const kicker = (t) => `<div class="kicker reveal">${t}</div>`;
const d = (n) => `style="--d:${n}"`;

// ─────────────────────────── slides ───────────────────────────

const s1 = `
<section class="slide s1" aria-label="Intro">
  <div class="cloud k1"></div><div class="cloud k2"></div><div class="cloud k3"></div>
  <div class="chips reveal" ${d(0)}><span class="chip">PL05 · PLAY LAB TRACK</span><span class="chip gold">IDEATION PHASE</span></div>
  <h1 class="logo reveal" ${d(1)}>LEARN YOUR<br>WAY OUT</h1>
  ${BEAN}
  <p class="tagline reveal" ${d(2)}>Every learning game is a quiz in a costume.<br>In ours, <b>the maze is the quiz.</b></p>
  <div class="info reveal" ${d(3)}><div><small>TEAM</small>Solo</div><div><small>PROJECT</small>PL05 – Learn Your Way Out</div><div><small>TRACK</small>Play Lab</div></div>
  <figure class="hero-shot back"><img src="assets/hub-ui.png" alt="Game hub with domain portals"></figure>
  <figure class="hero-shot front"><img src="assets/doorrush-clean.png" alt="Door Rush room: run through the right door"><figcaption class="proto">EARLY CONCEPT PROTOTYPE</figcaption></figure>
  <div class="slime big"><span>THE SLIME IS RISING</span></div>
</section>`;

const feats = [
  [fa.FaRunning, 'pink', 'Answer with your feet', '5 room types turn every question type into movement.'],
  [fa.FaLightbulb, 'gold', 'Wrong turns teach', 'A detour shows the answer, why, a worked example, a retry.'],
  [fa.FaChartLine, 'green', 'Adapts to every player', 'Harder after 2 right, easier after a miss; replay weak spots.'],
  [hi.HiSparkles, 'purple', 'AI custom questions', 'Type a topic or paste notes; DeepSeek builds a live pack.'],
  [fa.FaUsers, 'sky', 'Live multiplayer races', 'Race friends through the same seeded maze as ghost beans.'],
  [gi.GiMaze, 'orange', 'A new maze every run', 'Seeded mazes with forks, dead ends, coins and rising slime.'],
];
const rooms = [
  ['doorrush-clean', 'DOOR RUSH', 'multiple choice'], ['tiledrop', 'TILE DROP', 'true / false'],
  ['steps', 'STEP STONES', 'multi-step problems'], ['bridge', 'BRIDGE BUILDER', 'put in order'],
];
const s2 = `
<section class="slide content" aria-label="Proposed solution">
  ${kicker('02 · PROPOSED SOLUTION')}
  <h2 class="reveal" ${d(1)}>The maze is the quiz</h2>
  <p class="sub reveal" ${d(2)}>Most learning games pause the fun for a quiz popup. Here, every answer is a place you run to.</p>
  <ul class="feats">
    ${feats.map(([I, c, t, x], i) => `<li class="reveal" ${d(2 + i * 0.6)}><span class="ico ${c}">${ic(I)}</span><div><b>${t}</b><span>${x}</span></div></li>`).join('')}
  </ul>
  <div class="usp reveal" ${d(6)}><b>USP</b> Answers are places, not buttons. Mistakes become lessons, not game-overs.</div>
  <div class="rooms">
    ${rooms.map(([img, t, k], i) => `<figure class="room pop" ${d(3 + i * 0.7)}><img src="assets/${img}.png" alt="${t} room"><figcaption><b>${t}</b> ${k}</figcaption></figure>`).join('')}
    <span class="proto rooms-proto">EARLY CONCEPT PROTOTYPE</span>
  </div>
  ${slime(2, 6)}
</section>`;

const nodes = [['SELECT', 'domain + difficulty', 'sky'], ['GENERATE', 'seeded maze + rooms', 'sky'], ['NAVIGATE', '3D bean, minimap', 'sky'],
  ['CHALLENGE', 'room asks a question', 'gold'], ['EVALUATE', 'check, adapt tier', 'gold']];
const layers = [['UI', 'React DOM + zustand: HUD, menus, results', 'pink'], ['Render', 'three.js + React Three Fiber', 'purple'],
  ['Engine', 'TypeScript, fixed 120 Hz step, own collision', 'sky'], ['Content', 'JSON packs + validator, QuestionSource', 'green']];
const techs = [
  [gi.GiMaze, 'orange', 'Maze', 'DFS backtracker + braiding on a seeded PRNG: one seed, one identical maze.'],
  [fa.FaChartLine, 'green', 'Adaptive picker', 'tier staircase, scored by recency and weak concepts.'],
  [hi.HiSparkles, 'purple', 'AI pipeline', 'JSON schema → validator → cached pack; built-in bank fallback.'],
  [fa.FaUsers, 'sky', 'Multiplayer', 'share the seed, stream positions; each client runs its own course.'],
  [fa.FaVial, 'pink', 'Test plan', 'a headless bot plays every generated course before release.'],
];
const s3 = `
<section class="slide content" aria-label="Technical approach">
  ${kicker('03 · TECHNICAL APPROACH')}
  <h2 class="reveal" ${d(1)}>One loop, from pick to escape</h2>
  <div class="flow">
    ${nodes.map(([t, x, c], i) => `<div class="node ${c} pop" style="--d:${1.5 + i * 0.5};left:${i * 245}px"><i>${i + 1}</i><b>${t}</b><span>${x}</span></div>`).join('')}
    <div class="node green branch pop" style="--d:4.2;left:1255px;top:-10px"><b>PROGRESS</b><span>door opens, slime drops</span></div>
    <div class="node pink branch pop" style="--d:4.5;left:1255px;top:130px"><b>DETOUR</b><span>explain, example, retry</span></div>
    <div class="node ink pop" style="--d:5;left:1515px;width:185px"><b>WIN / LOSE</b><span>portal: win<br>slime full: out</span></div>
    <svg class="flow-lines" viewBox="0 0 1700 330" aria-hidden="true">
      <defs><marker id="ah" markerWidth="16" markerHeight="16" refX="12" refY="8" orient="auto" markerUnits="userSpaceOnUse" viewBox="0 0 16 16"><path d="M0,1 L16,8 L0,15 z" fill="#5B5F80"/></marker>
        <marker id="ahg" markerWidth="16" markerHeight="16" refX="12" refY="8" orient="auto" markerUnits="userSpaceOnUse" viewBox="0 0 16 16"><path d="M0,1 L16,8 L0,15 z" fill="#3DBE6A"/></marker>
        <marker id="ahp" markerWidth="16" markerHeight="16" refX="12" refY="8" orient="auto" markerUnits="userSpaceOnUse" viewBox="0 0 16 16"><path d="M0,1 L16,8 L0,15 z" fill="#FF4FA0"/></marker></defs>
      ${[0, 1, 2, 3].map((i) => `<line x1="${i * 245 + 218}" y1="120" x2="${i * 245 + 240}" y2="120" stroke="#5B5F80" stroke-width="3" marker-end="url(#ah)"/>`).join('')}
      <path d="M1198 120 L1250 50" stroke="#3DBE6A" stroke-width="3" fill="none" marker-end="url(#ahg)"/><text x="1205" y="70" class="mark g">✓</text>
      <path d="M1198 120 L1250 185" stroke="#FF4FA0" stroke-width="3" fill="none" marker-end="url(#ahp)"/><text x="1205" y="190" class="mark p">✗</text>
      <path d="M1467 45 L1512 105" stroke="#5B5F80" stroke-width="3" fill="none" marker-end="url(#ah)"/>
      <path d="M1467 185 L1512 132" stroke="#5B5F80" stroke-width="3" fill="none" marker-end="url(#ah)"/>
      <path d="M1607 198 L1607 300 L597 300 L597 190" stroke="#5B5F80" stroke-width="3" stroke-dasharray="10 8" fill="none" marker-end="url(#ah)"/>
      <text x="625" y="288" class="loop-label">not finished? back into the maze, next room</text>
    </svg>
  </div>
  <div class="card arch reveal" ${d(5.5)}>
    <small class="label pink-t">PLANNED BROWSER CLIENT</small>
    ${layers.map(([t, x, c]) => `<div class="layer ${c}"><b>${t}</b> ${x}</div>`).join('')}
  </div>
  <div class="services reveal" ${d(6)}>
    <div class="card svc"><small class="label purple-t">AI QUESTIONS</small><p>Node proxy → DeepSeek API; the key stays on the server.</p></div>
    <div class="card svc"><small class="label sky-t">MULTIPLAYER</small><p>WebSocket relay: shared seed + positions 10 times a second.</p></div>
    <svg class="links" viewBox="0 0 40 310" aria-hidden="true"><line x1="2" y1="75" x2="38" y2="75" stroke="#5B5F80" stroke-width="3" marker-end="url(#ah)"/><line x1="2" y1="230" x2="38" y2="230" stroke="#5B5F80" stroke-width="3" marker-end="url(#ah)"/></svg>
  </div>
  <ul class="techs reveal" ${d(6.5)}>
    ${techs.map(([I, c, t, x]) => `<li><span class="ico sm ${c}">${ic(I)}</span><p><b>${t}:</b> ${x}</p></li>`).join('')}
  </ul>
  ${slime(3, 6)}
</section>`;

const stats = [['4', 'domains at launch: math, science, history, programming', 'pink'], ['5', 'room types, one for each question format', 'purple'],
  ['3', 'difficulty levels, plus adaptive tiers', 'green'], ['0', 'installs: runs on laptops and phones from a link', 'orange']];
const phases = [['Concept & design', 'brief, mechanics, architecture', true], ['Core prototype', 'maze, 5 rooms, detour, slime'],
  ['Content & adaptivity', 'question packs, tiers, weak spots'], ['AI custom questions', 'DeepSeek packs from topics or notes'], ['Multiplayer & pilot', 'live races, a classroom trial']];
const groups = [['FEASIBILITY', 'pink', [[fa.FaCubes, 'Proven web stack: three.js + React'], [fa.FaMobileAlt, 'Pure browser, touch for phones'], [fa.FaLayerGroup, 'Modular: AI + multiplayer plug in']]],
  ['VIABILITY', 'green', [[fa.FaGlobe, 'Core is static files: free hosting'], [hi.HiSparkles, 'One AI call = one cached pack'], [fa.FaServer, 'Relay forwards positions only']]]];
const risks = [['Wrong AI facts', 'schema validator, second-pass check, teacher review'], ['AI latency', 'generate in the hub before the run; built-in bank fallback'],
  ['Leaked API key', 'key stays on a server proxy, never in the browser'], ['Lag in races', 'each client simulates locally; ghosts interpolate']];
const s4 = `
<section class="slide content" aria-label="Feasibility and viability">
  ${kicker('04 · FEASIBILITY &amp; VIABILITY')}
  <h2 class="reveal" ${d(1)}>Feasible, low-cost, low-risk</h2>
  <div class="stats">${stats.map(([n, l, c], i) => `<div class="card stat pop" ${d(1.5 + i * 0.4)}><b class="${c}-t">${n}</b><span>${l}</span></div>`).join('')}</div>
  <div class="card roadmap reveal" ${d(3.2)}>
    <small class="label sky-t">ROADMAP</small>
    <ol>${phases.map(([t, x, now]) => `<li class="${now ? 'now' : ''}"><b>${t}</b><span>${x}</span>${now ? '<em>WE ARE HERE</em>' : ''}</li>`).join('')}</ol>
  </div>
  <div class="card fv reveal" ${d(3.7)}>
    ${groups.map(([g, c, rows]) => `<small class="label ${c}-t">${g}</small><ul>${rows.map(([I, t]) => `<li><span class="ico sm ${c}">${ic(I)}</span>${t}</li>`).join('')}</ul>`).join('')}
  </div>
  <div class="card risks reveal" ${d(4.2)}>
    <small class="label purple-t">RISKS → MITIGATIONS</small>
    ${risks.map(([r, m]) => `<div><b>${r}</b><span>${m}</span></div>`).join('')}
  </div>
  ${slime(4, 6)}
</section>`;

const loop = [['TRY', 'answer in the maze', 'sky'], ['FEEDBACK', 'instant ✓ or ✗', 'gold'], ['EXPLAIN', 'answer + example', 'pink'],
  ['RETRY', 'a similar question', 'purple'], ['ADAPT', 'tier + weak spots', 'green']];
const CX = 320, CY = 330, RX = 215, RY = 235, NW = 210, NH = 100;
const pts = loop.map((_, i) => { const a = (-90 + i * 72) * Math.PI / 180; return [CX + RX * Math.cos(a), CY + RY * Math.sin(a)]; });
const loopArrows = pts.map((p, i) => {
  const q = pts[(i + 1) % 5]; const dx = q[0] - p[0], dy = q[1] - p[1], L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L;
  const e = Math.min((NW / 2 + 12) / Math.abs(ux || 1e-9), (NH / 2 + 12) / Math.abs(uy || 1e-9));
  return `<line x1="${(p[0] + ux * e).toFixed(1)}" y1="${(p[1] + uy * e).toFixed(1)}" x2="${(q[0] - ux * e).toFixed(1)}" y2="${(q[1] - uy * e).toFixed(1)}" stroke="#A3A7C2" stroke-width="4" marker-end="url(#ahl)"/>`;
}).join('');
const auds = [[fa.FaUserGraduate, 'pink', 'Students', 'Active recall in every room, safe low-stakes mistakes, and races with friends.'],
  [fa.FaChalkboardTeacher, 'purple', 'Teachers', 'Questions from your own notes in seconds, plus a weak-spot report per concept.'],
  [fa.FaSchool, 'green', 'Schools', 'No installs, runs on old laptops and phones; read-aloud, reduced motion, touch.']];
const s5 = `
<section class="slide content" aria-label="Impact and benefits">
  ${kicker('05 · IMPACT &amp; BENEFITS')}
  <h2 class="reveal" ${d(1)}>Mistakes become lessons</h2>
  <figure class="results reveal" ${d(1.5)}><img src="assets/results-card.png" alt="Results card with mastery per concept and a review of misses"><span class="proto">EARLY CONCEPT PROTOTYPE</span>
    <figcaption>Planned: every run ends with mastery per concept and a review of every miss.</figcaption></figure>
  <div class="loop">
    <svg viewBox="0 0 640 660" aria-hidden="true"><defs><marker id="ahl" markerWidth="16" markerHeight="16" refX="12" refY="8" orient="auto" markerUnits="userSpaceOnUse" viewBox="0 0 16 16"><path d="M0,1 L16,8 L0,15 z" fill="#A3A7C2"/></marker></defs>${loopArrows}</svg>
    ${loop.map(([t, x, c], i) => `<div class="lnode ${c} pop" style="--d:${2 + i * 0.5};left:${(pts[i][0] - NW / 2).toFixed(0)}px;top:${(pts[i][1] - NH / 2).toFixed(0)}px"><b>${t}</b><span>${x}</span></div>`).join('')}
    <div class="loop-center"><small>THE LEARNING<br>LOOP</small></div>
  </div>
  <div class="auds">${auds.map(([I, c, t, x], i) => `<div class="card aud reveal" ${d(3 + i * 0.5)}><span class="ico ${c}">${ic(I)}</span><b>${t}</b><p>${x}</p></div>`).join('')}</div>
  ${slime(5, 6)}
</section>`;

const rows = [['Testing effect', 'Roediger &amp; Karpicke, 2006', 'Every room is a retrieval attempt, answered by moving', 'sky'],
  ['Feedback', 'Hattie &amp; Timperley, 2007', 'Instant ✓ or ✗ on the door, tile or step you chose', 'gold'],
  ['Learning from errors', 'Metcalfe, 2017', 'A wrong answer opens a detour: answer, why, worked example, retry', 'pink'],
  ['Desirable difficulty &amp; flow', 'Bjork &amp; Bjork, 2011; Csikszentmihalyi, 1990', 'The adaptive tier keeps the challenge just above skill', 'purple'],
  ['Spacing', 'Cepeda et al., 2006', 'Weak-spot runs bring missed concepts back later', 'green'],
  ['Games that teach', 'Wouters et al., 2013; Clark et al., 2016', 'The learning is the core mechanic, not a popup', 'orange']];
const refs = ['Roediger &amp; Karpicke (2006). Test-enhanced learning. <i>Psychological Science</i>, 17(3).',
  'Hattie &amp; Timperley (2007). The power of feedback. <i>Review of Educational Research</i>, 77(1).',
  'Metcalfe (2017). Learning from errors. <i>Annual Review of Psychology</i>, 68.',
  'Bjork &amp; Bjork (2011). Making things hard on yourself, but in a good way. <i>Psychology and the Real World</i>.',
  'Csikszentmihalyi (1990). <i>Flow: The Psychology of Optimal Experience</i>.',
  'Cepeda et al. (2006). Distributed practice in verbal recall tasks. <i>Psychological Bulletin</i>, 132(3).',
  'Wouters et al. (2013). Effects of serious games. <i>J. Educational Psychology</i>, 105(2).',
  'Clark, Tanner-Smith &amp; Killingsworth (2016). Digital games, design, and learning. <i>Rev. Educ. Research</i>, 86(1).',
  'Buck (2015). <i>Mazes for Programmers</i>. Pragmatic Bookshelf.',
  'Fiedler (2004). Fix Your Timestep! gafferongames.com.',
  'Docs: three.js, React Three Fiber, DeepSeek API. Art direction: Fall Guys (Mediatonic, 2020).'];
const s6 = `
<section class="slide content" aria-label="Research and references">
  ${kicker('06 · RESEARCH &amp; REFERENCES')}
  <h2 class="reveal" ${d(1)}>Grounded in learning science</h2>
  <div class="map">
    <div class="map-head"><small class="label">RESEARCH SAYS</small><small class="label">SO THE GAME DOES</small></div>
    ${rows.map(([f, c, m, col], i) => `<div class="map-row reveal" ${d(1.5 + i * 0.4)}><div class="res ${col}"><b>${f}</b><i>${c}</i></div><span class="arr ${col}-t">→</span><div class="card mech">${m}</div></div>`).join('')}
  </div>
  <div class="card refs reveal" ${d(2)}><small class="label pink-t">REFERENCES</small><ol>${refs.map((r) => `<li>${r}</li>`).join('')}</ol></div>
  ${slime(6, 6)}
</section>`;

// ─────────────────────────── styles ───────────────────────────

const CSS = `
/* ===========================================
   THEME: Game Arena (built from the game's own palette, src/game/palette.ts)
   Change these variables to restyle the whole deck.
   =========================================== */
:root {
  --sky: #6EC6FF; --sky-l: #DDF2FF; --horizon: #FFD9F0; --ink: #2B2D42; --muted: #5B5F80; --paper: #F4FAFF;
  --pink: #FF4FA0; --pink-l: #FFE3F0; --gold: #FFC93C; --gold-l: #FFF3CF; --green: #3DBE6A; --green-l: #DDF6E5;
  --purple: #7A4DFF; --purple-l: #EAE2FF; --orange: #FF8A3D; --orange-l: #FFE8D8; --slime: #7CFF4F;
  --font-display: 'Titan One', cursive; --font-body: 'Nunito', sans-serif;
  --stage-bg: #1d2236; --slide-bg: var(--paper);
  --shadow: 0 8px 0 rgba(43, 45, 66, .13);
  --spring: cubic-bezier(.2, 1.5, .4, 1); --ease: cubic-bezier(.16, 1, .3, 1);
}
* { margin: 0; padding: 0; box-sizing: border-box; }

${BASE_CSS}

/* === BASE TYPE & SURFACES === */
.slide { font-family: var(--font-body); color: var(--ink); }
.slide.content { background: linear-gradient(180deg, #E7F5FF 0%, #F6FBFF 55%, #FFF3FA 100%); }
.card { position: absolute; background: #fff; border-radius: 30px; box-shadow: var(--shadow); }
.label { display: block; font-weight: 900; font-size: 20px; letter-spacing: .12em; color: var(--muted); }
.pink-t { color: var(--pink) } .purple-t { color: var(--purple) } .green-t { color: var(--green) } .orange-t { color: var(--orange) }
.sky-t { color: #2E8FD6 } .gold-t { color: #D9A400 }
.kicker { position: absolute; left: 110px; top: 62px; padding: 9px 24px; border-radius: 40px; background: var(--pink); color: #fff; font-weight: 900; font-size: 20px; letter-spacing: .12em; }
h2 { position: absolute; left: 106px; top: 110px; font-family: var(--font-display); font-weight: 400; font-size: 78px; line-height: 1.1; letter-spacing: .005em; }
.sub { position: absolute; left: 110px; top: 212px; font-size: 30px; font-style: italic; font-weight: 700; color: var(--muted); }
.proto { display: inline-block; background: var(--ink); color: #fff; font-weight: 900; font-size: 17px; letter-spacing: .1em; padding: 8px 18px; border-radius: 22px; }

/* Icon circles (react-icons SVG inside) */
.ico { flex: none; display: grid; place-items: center; width: 64px; height: 64px; border-radius: 50%; font-size: 30px; }
.ico.sm { width: 46px; height: 46px; font-size: 22px; }
.ico.pink { background: var(--pink-l); color: var(--pink) } .ico.gold { background: var(--gold-l); color: #D9A400 }
.ico.green { background: var(--green-l); color: var(--green) } .ico.purple { background: var(--purple-l); color: var(--purple) }
.ico.sky { background: var(--sky-l); color: #2E8FD6 } .ico.orange { background: var(--orange-l); color: var(--orange) }

/* === RISING SLIME FOOTER (grows per slide: the deck's progress bar) === */
.slime { position: absolute; left: -40px; right: -40px; bottom: 0; height: var(--h, 70px); background: var(--slime);
  border-top-left-radius: 50% 34px; border-top-right-radius: 50% 34px; box-shadow: inset 0 12px 0 rgba(255,255,255,.45);
  display: flex; justify-content: space-between; align-items: flex-end; padding: 0 150px 18px; font-weight: 900; font-size: 18px; letter-spacing: .14em; color: #2f7d18;
  animation: ooze 3.2s ease-in-out infinite alternate; }
@keyframes ooze { from { transform: translateY(6px) } to { transform: translateY(-6px) } }
.slime.big { height: 170px; justify-content: flex-end; padding-bottom: 54px; font-family: var(--font-display); font-weight: 400; font-size: 32px; letter-spacing: .06em; }

/* === ENTRANCE ANIMATIONS (trigger on .visible; --d staggers in 0.12s steps) === */
.reveal { opacity: 0; transform: translateY(34px); transition: opacity .7s var(--ease), transform .7s var(--ease); transition-delay: calc(var(--d, 0) * .12s); }
.pop { opacity: 0; transform: scale(.82) translateY(20px); transition: opacity .5s ease, transform .7s var(--spring); transition-delay: calc(var(--d, 0) * .12s); }
.slide.visible .reveal, .slide.visible .pop { opacity: 1; transform: none; }

/* === SLIDE 1: TITLE === */
.s1 { background: linear-gradient(180deg, var(--sky) 0%, #BFE6FF 70%, var(--horizon) 100%); }
.cloud { position: absolute; background: #fff; border-radius: 100px; opacity: .8; animation: drift 30s linear infinite alternate; }
.cloud::before, .cloud::after { content: ''; position: absolute; background: #fff; border-radius: 50%; }
.cloud::before { width: 55%; height: 160%; left: 15%; top: -70% } .cloud::after { width: 40%; height: 130%; right: 12%; top: -45% }
.k1 { width: 300px; height: 70px; left: 120px; top: 120px } .k2 { width: 220px; height: 54px; left: 980px; top: 60px; opacity: .6 } .k3 { width: 260px; height: 60px; left: 1500px; top: 900px; opacity: .5 }
@keyframes drift { to { transform: translateX(80px) } }
.chips { position: absolute; left: 110px; top: 110px; display: flex; gap: 16px; }
.chip { padding: 12px 28px; border-radius: 40px; background: #fff; font-weight: 900; font-size: 24px; letter-spacing: .08em; color: var(--pink); box-shadow: 0 6px 0 rgba(43,45,66,.18); }
.chip.gold { background: var(--gold); color: var(--ink); }
.logo { position: absolute; left: 104px; top: 190px; font-family: var(--font-display); font-weight: 400; font-size: 138px; line-height: 1.02; color: #fff;
  -webkit-text-stroke: 7px var(--ink); paint-order: stroke fill; text-shadow: 0 12px 0 rgba(43,45,66,.25); }
.s1 .bean { position: absolute; left: 790px; top: 330px; width: 120px; height: 206px; animation: hop 1.6s ease-in-out infinite; }
@keyframes hop { 0%, 100% { transform: translateY(0) rotate(8deg) } 50% { transform: translateY(-26px) rotate(-4deg) } }
.tagline { position: absolute; left: 112px; top: 610px; font-size: 40px; line-height: 1.3; font-weight: 700; font-style: italic; }
.tagline b { color: var(--pink); }
.info { position: absolute; left: 110px; top: 760px; display: flex; gap: 22px; }
.info div { background: #fff; border-radius: 28px; padding: 22px 30px; box-shadow: 0 8px 0 rgba(43,45,66,.16); font-size: 30px; font-weight: 800; }
.info small { display: block; font-size: 18px; letter-spacing: .12em; color: var(--pink); font-weight: 900; margin-bottom: 4px; }
.hero-shot { position: absolute; border: 10px solid #fff; border-radius: 34px; overflow: hidden; box-shadow: 0 14px 0 rgba(43,45,66,.2); transition: transform .9s var(--spring), opacity .6s; opacity: 0; }
.hero-shot img { display: block; width: 100%; max-width: none; max-height: none; }
.hero-shot.back { left: 1180px; top: 90px; width: 640px; transform: rotate(-4deg) translateY(80px); transition-delay: .25s; }
.hero-shot.front { left: 1060px; top: 400px; width: 760px; transform: rotate(3deg) translateY(120px); transition-delay: .45s; }
.slide.visible .hero-shot.back { opacity: 1; transform: rotate(-4deg); } .slide.visible .hero-shot.front { opacity: 1; transform: rotate(3deg); }
.hero-shot .proto { position: absolute; left: 16px; bottom: 16px; }

/* === SLIDE 2: SOLUTION === */
.feats { position: absolute; left: 110px; top: 285px; width: 760px; list-style: none; display: grid; gap: 22px; }
.feats li { display: flex; gap: 22px; align-items: center; }
.feats b { display: block; font-size: 30px; font-weight: 800; line-height: 1.15; }
.feats li span:not(.ico) { display: block; font-size: 23px; color: var(--muted); font-weight: 600; margin-top: 2px; }
.usp { position: absolute; left: 110px; top: 850px; width: 760px; padding: 20px 30px; border-radius: 26px; background: var(--ink); color: #fff; font-size: 26px; font-weight: 800; line-height: 1.3; }
.usp b { color: var(--gold); margin-right: 10px; }
.rooms { position: absolute; left: 930px; top: 285px; width: 880px; display: grid; grid-template-columns: 1fr 1fr; gap: 30px 30px; }
.room { background: #fff; border-radius: 24px; padding: 8px; box-shadow: var(--shadow); }
.room img { display: block; width: 100%; border-radius: 18px; max-width: none; max-height: none; }
.room figcaption { padding: 10px 8px 4px; font-size: 21px; font-weight: 700; color: var(--muted); }
.room figcaption b { color: var(--pink); font-weight: 900; letter-spacing: .06em; margin-right: 8px; }
.rooms-proto { position: absolute; right: 18px; top: -20px; }

/* === SLIDE 3: TECHNICAL === */
.flow { position: absolute; left: 110px; top: 280px; width: 1700px; height: 330px; }
.node { position: absolute; top: 60px; width: 218px; height: 120px; border-radius: 22px; border: 3px solid; padding: 18px 14px; text-align: center; }
.node b { display: block; font-size: 25px; font-weight: 900; letter-spacing: .02em; }
.node span { display: block; font-size: 20px; color: var(--muted); font-weight: 700; margin-top: 6px; line-height: 1.2; }
.node i { position: absolute; left: -14px; top: -16px; width: 38px; height: 38px; border-radius: 50%; background: var(--ink); color: #fff; font-style: normal; font-weight: 900; font-size: 20px; display: grid; place-items: center; }
.node.sky { background: var(--sky-l); border-color: #4DB2F0 } .node.gold { background: var(--gold-l); border-color: #E8B21E }
.node.green { background: var(--green-l); border-color: var(--green) } .node.pink { background: var(--pink-l); border-color: var(--pink) }
.node.branch { width: 212px; height: 110px; padding-top: 14px; }
.node.ink { background: var(--ink); border-color: var(--ink); color: #fff; top: 45px; height: 150px; } .node.ink span { color: #D6D8EA; font-size: 19px; }
.flow-lines { position: absolute; inset: 0; width: 1700px; height: 330px; overflow: visible; }
.flow-lines .mark { font-size: 26px; font-weight: 900; } .mark.g { fill: var(--green) } .mark.p { fill: var(--pink) }
.loop-label { font: italic 700 20px var(--font-body); fill: var(--muted); }
.arch { left: 110px; top: 660px; width: 770px; height: 300px; padding: 22px 26px; }
.layer { margin-top: 12px; padding: 12px 20px; border-radius: 14px; font-size: 21px; color: var(--muted); font-weight: 600; }
.layer b { color: var(--ink); font-weight: 900; margin-right: 10px; }
.layer.pink { background: var(--pink-l) } .layer.purple { background: var(--purple-l) } .layer.sky { background: var(--sky-l) } .layer.green { background: var(--green-l) }
.services { position: absolute; left: 880px; top: 660px; width: 400px; height: 300px; }
.services .svc { left: 50px; width: 350px; height: 140px; padding: 20px 24px; }
.services .svc:nth-child(2) { top: 160px; }
.svc p { font-size: 21px; font-weight: 700; margin-top: 8px; line-height: 1.3; }
.links { position: absolute; left: 4px; top: 0; width: 40px; height: 310px; }
.techs { position: absolute; left: 1320px; top: 655px; width: 490px; list-style: none; display: grid; gap: 14px; }
.techs li { display: flex; gap: 14px; align-items: flex-start; }
.techs p { font-size: 20px; line-height: 1.28; color: var(--muted); font-weight: 600; } .techs b { color: var(--ink); font-weight: 900; }

/* === SLIDE 4: FEASIBILITY === */
.stats { position: absolute; left: 110px; top: 250px; width: 1700px; display: grid; grid-template-columns: repeat(4, 1fr); gap: 24px; }
.stat { position: relative; padding: 18px 30px 22px; }
.stat b { display: block; font-family: var(--font-display); font-weight: 400; font-size: 76px; line-height: 1.05; }
.stat span { display: block; font-size: 21px; color: var(--muted); font-weight: 700; line-height: 1.3; }
.roadmap { left: 110px; top: 470px; width: 560px; height: 490px; padding: 28px 32px; }
.roadmap ol { list-style: none; margin-top: 18px; position: relative; }
.roadmap ol::before { content: ''; position: absolute; left: 14px; top: 16px; bottom: 30px; width: 4px; background: #D3DCEA; border-radius: 2px; }
.roadmap li { position: relative; padding-left: 52px; margin-bottom: 18px; }
.roadmap li::before { content: ''; position: absolute; left: 2px; top: 6px; width: 28px; height: 28px; border-radius: 50%; background: #fff; border: 4px solid #A3A7C2; box-sizing: border-box; }
.roadmap li.now::before { background: var(--pink); border-color: var(--pink); box-shadow: 0 0 0 8px var(--pink-l); }
.roadmap li b { display: block; font-size: 26px; font-weight: 900; }
.roadmap li span { display: block; font-size: 20px; color: var(--muted); font-weight: 600; }
.roadmap li em { position: absolute; right: 0; top: 2px; font-style: normal; background: var(--pink); color: #fff; font-weight: 900; font-size: 15px; letter-spacing: .1em; padding: 6px 14px; border-radius: 20px; }
.fv { left: 700px; top: 470px; width: 540px; height: 490px; padding: 28px 32px; }
.fv ul { list-style: none; margin: 14px 0 22px; display: grid; gap: 12px; }
.fv li { display: flex; align-items: center; gap: 16px; font-size: 23px; font-weight: 700; }
.risks { left: 1270px; top: 470px; width: 540px; height: 490px; padding: 28px 32px; }
.risks div { margin-top: 20px; } .risks b { display: block; font-size: 24px; font-weight: 900; }
.risks span { display: block; font-size: 21px; color: var(--muted); font-weight: 600; line-height: 1.3; margin-top: 2px; }

/* === SLIDE 5: IMPACT === */
.results { position: absolute; left: 110px; top: 250px; width: 500px; }
.results img { display: block; width: 100%; border: 10px solid #fff; border-radius: 28px; box-shadow: 0 10px 0 rgba(43,45,66,.15); max-width: none; max-height: none; }
.results .proto { position: absolute; right: 14px; top: -18px; }
.results figcaption { margin-top: 18px; font-size: 21px; font-style: italic; font-weight: 700; color: var(--muted); line-height: 1.3; }
.loop { position: absolute; left: 640px; top: 260px; width: 640px; height: 660px; }
.loop svg { position: absolute; inset: 0; width: 640px; height: 660px; }
.lnode { position: absolute; width: 210px; height: 100px; border-radius: 22px; border: 3px solid; text-align: center; padding-top: 16px; }
.lnode b { display: block; font-size: 24px; font-weight: 900; letter-spacing: .03em; }
.lnode span { display: block; font-size: 19px; color: var(--muted); font-weight: 700; margin-top: 4px; }
.lnode.sky { background: var(--sky-l); border-color: #4DB2F0 } .lnode.gold { background: var(--gold-l); border-color: #E8B21E }
.lnode.pink { background: var(--pink-l); border-color: var(--pink) } .lnode.purple { background: var(--purple-l); border-color: var(--purple) }
.lnode.green { background: var(--green-l); border-color: var(--green) }
.loop-center { position: absolute; left: 225px; top: 330px; width: 190px; text-align: center; }
.loop-center .bean { display: block; margin: 0 auto; width: 60px; height: 103px; animation: hop 1.6s ease-in-out infinite; }
.loop-center small { display: block; font-weight: 900; font-size: 16px; letter-spacing: .1em; line-height: 1.3; color: var(--pink); margin-top: 6px; }
.auds { position: absolute; left: 1310px; top: 250px; width: 500px; height: 710px; }
.aud { position: relative; display: block; height: 218px; margin-bottom: 24px; padding: 26px 30px; }
.aud .ico { position: absolute; left: 30px; top: 24px; }
.aud b { display: block; margin-left: 84px; font-size: 32px; font-weight: 900; line-height: 64px; }
.aud p { margin-top: 18px; font-size: 22px; color: var(--muted); font-weight: 600; line-height: 1.35; }

/* === SLIDE 6: RESEARCH === */
.map { position: absolute; left: 110px; top: 250px; width: 1060px; }
.map-head { display: grid; grid-template-columns: 450px 1fr; padding-left: 4px; margin-bottom: 14px; }
.map-head .label:last-child { padding-left: 64px; }
.map-row { display: grid; grid-template-columns: 450px 64px 1fr; align-items: stretch; margin-bottom: 14px; height: 94px; }
.res { border-radius: 20px; padding: 14px 22px; } .res b { display: block; font-size: 24px; font-weight: 900; }
.res i { display: block; font-size: 19px; color: var(--muted); font-weight: 600; margin-top: 2px; }
.res.sky { background: var(--sky-l) } .res.gold { background: var(--gold-l) } .res.pink { background: var(--pink-l) }
.res.purple { background: var(--purple-l) } .res.green { background: var(--green-l) } .res.orange { background: var(--orange-l) }
.arr { display: grid; place-items: center; font-size: 38px; font-weight: 900; }
.mech { position: relative; border-radius: 20px; padding: 0 24px; display: flex; align-items: center; font-size: 22px; font-weight: 700; line-height: 1.3; }
.refs { left: 1200px; top: 250px; width: 610px; height: 710px; padding: 28px 32px; }
.refs ol { margin-top: 14px; padding-left: 30px; display: grid; gap: 9px; }
.refs li { font-size: 18.5px; line-height: 1.32; font-weight: 600; } .refs li::marker { color: var(--pink); font-weight: 900; }

/* === DECK CHROME (outside the stage): progress dots + edit toggle === */
.deck-controls { display: flex; gap: 10px; }
body.export .deck-controls, body.export .edit-toggle { display: none; }
.deck-controls button { width: 12px; height: 12px; border-radius: 50%; border: 0; background: rgba(255,255,255,.4); cursor: pointer; }
.deck-controls button.on { background: #fff; }
.edit-hotzone { position: fixed; top: 0; left: 0; width: 80px; height: 80px; z-index: 10000; cursor: pointer; }
.edit-toggle { position: fixed; top: 16px; left: 16px; z-index: 10001; width: 46px; height: 46px; border-radius: 50%; border: 0; background: #fff; font-size: 22px;
  opacity: 0; pointer-events: none; transition: opacity .3s; box-shadow: 0 4px 0 rgba(0,0,0,.2); cursor: pointer; }
.edit-toggle.show, .edit-toggle.active { opacity: 1; pointer-events: auto; }
.edit-toggle.active { background: var(--gold); }
body.editing [contenteditable="true"] { outline: 2px dashed rgba(255, 79, 160, .5); outline-offset: 4px; }
`;

// ─────────────────────────── controller ───────────────────────────

const JS = `
/* ===========================================
   SLIDE PRESENTATION CONTROLLER
   Keyboard (arrows, space, page up/down), wheel, touch; fixed-stage scaling.
   ?slide=N opens slide N (used by the PDF export).
   =========================================== */
class SlidePresentation {
  constructor() {
    this.slides = [...document.querySelectorAll('.slide')];
    this.stage = document.getElementById('deckStage');
    this.dots = document.getElementById('deckDots');
    this.current = 0; this.wheelLock = false;
    this.slides.forEach((_, i) => { const b = document.createElement('button'); b.setAttribute('aria-label', 'Slide ' + (i + 1)); b.onclick = () => this.show(i); this.dots.append(b); });
    this.scale(); addEventListener('resize', () => this.scale());
    addEventListener('keydown', (e) => {
      if (e.target.isContentEditable) return;
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); this.show(this.current + 1); }
      if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) { e.preventDefault(); this.show(this.current - 1); }
      if (e.key === 'Home') this.show(0); if (e.key === 'End') this.show(this.slides.length - 1);
    });
    addEventListener('wheel', (e) => { if (this.wheelLock || Math.abs(e.deltaY) < 20) return; this.wheelLock = true; this.show(this.current + Math.sign(e.deltaY)); setTimeout(() => (this.wheelLock = false), 700); }, { passive: true });
    let x0 = null; addEventListener('touchstart', (e) => (x0 = e.touches[0].clientX), { passive: true });
    addEventListener('touchend', (e) => { if (x0 === null) return; const dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 50) this.show(this.current + (dx < 0 ? 1 : -1)); x0 = null; });
    const start = parseInt(new URLSearchParams(location.search).get('slide') || '1', 10) - 1;
    this.show(isNaN(start) ? 0 : start);
  }
  scale() {
    const f = Math.min(innerWidth / 1920, innerHeight / 1080);
    this.stage.style.transform = 'translate(' + (innerWidth - 1920 * f) / 2 + 'px,' + (innerHeight - 1080 * f) / 2 + 'px) scale(' + f + ')';
  }
  show(i) {
    this.current = Math.max(0, Math.min(i, this.slides.length - 1));
    this.slides.forEach((s, k) => { s.classList.toggle('active', k === this.current); s.classList.remove('visible'); });
    requestAnimationFrame(() => requestAnimationFrame(() => this.slides[this.current].classList.add('visible')));
    [...this.dots.children].forEach((b, k) => b.classList.toggle('on', k === this.current));
  }
}

/* ===========================================
   INLINE EDITING: hover top-left corner or press E; edits auto-save to localStorage.
   =========================================== */
const editor = {
  isActive: false, key: 'lywo-deck-edits',
  targets() { return document.querySelectorAll('.slide h1, .slide h2, .slide p, .slide b, .slide span:not(.ico):not(.proto), .slide li, .slide small, .slide figcaption, .slide em, .slide i'); },
  toggleEditMode() {
    this.isActive = !this.isActive;
    document.body.classList.toggle('editing', this.isActive);
    document.getElementById('editToggle').classList.toggle('active', this.isActive);
    this.targets().forEach((el) => el.setAttribute('contenteditable', this.isActive ? 'true' : 'false'));
    if (!this.isActive) this.save();
  },
  save() { try { localStorage.setItem(this.key, JSON.stringify([...this.targets()].map((el) => el.innerHTML))); } catch (e) {} },
  load() { try { const saved = JSON.parse(localStorage.getItem(this.key) || 'null'); if (saved) this.targets().forEach((el, i) => { if (saved[i] !== undefined) el.innerHTML = saved[i]; }); } catch (e) {} },
};
document.addEventListener('input', () => editor.save());
const hotzone = document.querySelector('.edit-hotzone'), editToggle = document.getElementById('editToggle');
let hideTimeout = null;
editToggle.addEventListener('click', () => editor.toggleEditMode());
hotzone.addEventListener('click', () => editor.toggleEditMode());
hotzone.addEventListener('mouseenter', () => { clearTimeout(hideTimeout); editToggle.classList.add('show'); });
hotzone.addEventListener('mouseleave', () => { hideTimeout = setTimeout(() => { if (!editor.isActive) editToggle.classList.remove('show'); }, 400); });
editToggle.addEventListener('mouseenter', () => clearTimeout(hideTimeout));
editToggle.addEventListener('mouseleave', () => { hideTimeout = setTimeout(() => { if (!editor.isActive) editToggle.classList.remove('show'); }, 400); });
document.addEventListener('keydown', (e) => { if ((e.key === 'e' || e.key === 'E') && !e.target.isContentEditable) editor.toggleEditMode(); });
if (new URLSearchParams(location.search).has('slide')) document.body.classList.add('export'); else editor.load();
new SlidePresentation();
`;

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Learn Your Way Out · PL05 pitch</title>
<!-- Fonts: Titan One (display, the game's chunky look) + Nunito (body, the game's UI font) -->
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Titan+One&family=Nunito:ital,wght@0,600;0,700;0,800;0,900;1,600;1,700&display=swap" rel="stylesheet">
<style>
${CSS}
</style>
</head>
<body>
<div class="edit-hotzone"></div>
<button class="edit-toggle" id="editToggle" title="Edit mode (E)" aria-label="Toggle edit mode">✏️</button>
<div class="deck-viewport">
  <main class="deck-stage" id="deckStage">
${[s1, s2, s3, s4, s5, s6].join('\n')}
  </main>
</div>
<nav class="deck-controls" id="deckDots" aria-label="Slides"></nav>
<script>
${JS}
</script>
</body>
</html>
`;
fs.writeFileSync(OUT, html);
console.log('wrote', OUT, (html.length / 1024).toFixed(0) + ' KB');
