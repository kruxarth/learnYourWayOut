import { useEffect, useState } from 'react';
import { engine } from '../game/engine';

export default function DebugOverlay() {
  const [text, setText] = useState('');
  useEffect(() => {
    let frames = 0, last = performance.now(), fps = 0;
    let raf = 0;
    const loop = () => { frames++; raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    const id = setInterval(() => {
      const now = performance.now();
      fps = Math.round((frames * 1000) / (now - last)); frames = 0; last = now;
      const p = engine.player.pos, run = engine.run;
      const room = run?.activeRoomId ?? '-';
      setText([
        `FPS ${fps}`,
        `pos ${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}`,
        run ? `seg ${run.segIndex} · room ${room} · zone ${run.zone}` : `mode ${engine.mode}`,
        run ? `slime ${run.slime.toFixed(3)} · tier ${run.tier} · seed ${run.seed}` : '',
      ].filter(Boolean).join('\n'));
    }, 250);
    return () => { cancelAnimationFrame(raf); clearInterval(id); };
  }, []);
  return <div className="debug">{text}</div>;
}
