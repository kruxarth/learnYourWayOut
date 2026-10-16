import { useRef, useState } from 'react';
import { input } from '../game/input';
import { useUI } from './store';

const BASE = 120, KNOB = 50, DEAD = 0.12;

/** Virtual joystick + buttons for touch devices. Camera yaw stays 0. */
export default function TouchControls() {
  const screen = useUI((s) => s.screen);
  const room = useUI((s) => s.room);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const joy = useRef<{ id: number; cx: number; cy: number } | null>(null);
  if (screen === 'results') return null;

  const update = (e: React.PointerEvent) => {
    const j = joy.current;
    if (!j || e.pointerId !== j.id) return;
    let dx = e.clientX - j.cx, dy = e.clientY - j.cy;
    const max = (BASE - KNOB) / 2 + 10;
    const len = Math.hypot(dx, dy);
    if (len > max) { dx = (dx / len) * max; dy = (dy / len) * max; }
    setKnob({ x: dx, y: dy });
    let nx = dx / max, ny = -dy / max;
    const m = Math.hypot(nx, ny);
    if (m < DEAD) { nx = 0; ny = 0; } else { const k = (m - DEAD) / (1 - DEAD) / m; nx *= k; ny *= k; }
    input.setTouchMove(nx, ny);
  };
  const end = (e: React.PointerEvent) => {
    if (joy.current && e.pointerId === joy.current.id) { joy.current = null; setKnob({ x: 0, y: 0 }); input.setTouchMove(0, 0); }
  };

  const btn = (kind: 'jump' | 'fifty' | 'hint' | 'drop' | 'pause') => (e: React.PointerEvent) => { e.preventDefault(); input.press(kind); };
  const carrying = !!room?.bridge?.carrying;

  return (
    <div className="touch" aria-hidden="true">
      <div
        className="joy-base"
        onPointerDown={(e) => {
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          joy.current = { id: e.pointerId, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          update(e);
        }}
        onPointerMove={update}
        onPointerUp={end}
        onPointerCancel={end}
      >
        <div className="joy-knob" style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
      </div>
      <button className="touch-btn jump" onPointerDown={btn('jump')}>JUMP</button>
      <button className="touch-btn small" style={{ bottom: 120 }} onPointerDown={btn('fifty')}>50/50</button>
      <button className="touch-btn small" style={{ bottom: 186 }} onPointerDown={btn('hint')}>Hint</button>
      {carrying && <button className="touch-btn small" style={{ bottom: 252 }} onPointerDown={btn('drop')}>Drop</button>}
    </div>
  );
}
