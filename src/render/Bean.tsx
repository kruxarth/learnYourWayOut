import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Group } from 'three';
import { engine } from '../game/engine';
import { T } from '../game/tuning';
import { useUI } from '../ui/store';
import Avatar from './avatar/Avatar';
import { MAX_LEAN, makePose } from './avatar/pose';

/** The player: owns the spring, lean, waddle, blink and fake-ragdoll spin, and writes them into a pose for `Avatar`. */
export default function Bean() {
  const root = useRef<Group>(null);
  const config = useUI((s) => s.avatar);
  const pose = useMemo(() => makePose(), []);
  const spring = useRef({ s: 0, v: 0, t: 0, blink: 3, blinkT: 0, foot: 0 });

  useEffect(() => {
    const off = engine.events.on((e) => {
      const sp = spring.current;
      if (e.type === 'jump') sp.v += 4;
      else if (e.type === 'land') sp.v -= Math.min(6, e.impact * 0.4);
      else if (e.type === 'bounce') {
        // render-only randomness (cosmetic spin axis)
        const a = Math.random() * Math.PI * 2;
        pose.spinAxisX = Math.cos(a); pose.spinAxisZ = Math.sin(a);
        engine.player.spin = 0.5;
      }
    });
    return () => { off(); };
  }, [pose]);

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const r = root.current;
    if (!r) return;
    const p = engine.player, sp = spring.current;
    sp.t += dt;
    // spring: s'' = -180 s - 14 s'
    const acc = -180 * sp.s - 14 * sp.v;
    sp.v += acc * dt;
    sp.s += sp.v * dt;
    r.position.set(p.pos.x, p.pos.y, p.pos.z);
    r.rotation.y = p.facing;
    const speed = Math.hypot(p.vel.x, p.vel.z);
    const k = Math.min(1, speed / T.MAX_SPEED);
    pose.squash = sp.s;
    pose.lean = MAX_LEAN * k;                       // lean forward (model faces −Z)
    pose.waddle = Math.sin(sp.t * 14) * 0.08 * k;
    sp.foot += dt * 14 * (0.3 + k);
    pose.footPhase = sp.foot;
    pose.spinAngle = p.spin > 0 ? (1 - p.spin / 0.5) * Math.PI * 2 : 0;
    // blink (P1)
    sp.blink -= dt;
    pose.blink = 1;
    if (sp.blink < 0) { sp.blinkT += dt; pose.blink = 0.1; if (sp.blinkT > 0.12) { sp.blink = 3 + Math.random() * 2; sp.blinkT = 0; } }
  });

  return (
    <group ref={root}>
      <Avatar config={config} pose={pose} />
    </group>
  );
}
