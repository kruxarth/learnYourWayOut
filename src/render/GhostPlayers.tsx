import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Mesh, SpriteMaterial, type Group, type Material, type Sprite } from 'three';
import type { AvatarConfig } from '../game/avatar';
import { BODY_COLORS } from '../game/palette';
import { T } from '../game/tuning';
import { makeSampled, sampleSnapshots, type SnapshotSource } from '../net/interp';
import { tagTextColor } from '../net/race';
import Avatar from './avatar/Avatar';
import { MAX_LEAN, makePose } from './avatar/pose';
import { labelTexture, releaseLabel } from './labels';
import { visOpacity, withVisibility } from './visibility';

/** How a `GhostPlayers` set looks. The defaults are the daily ghost: faint, and gone once its run is over. */
export interface GhostLook {
  opacity?: number;
  /** A stale player fades to `staleOpacity` and shows a 📶 tag instead of disappearing (online). */
  fadeWhenStale?: boolean;
  staleOpacity?: number;
  /** Name-tag text per player (omit for no tags). */
  tag?: (id: string) => string;
  /** True to hide a player entirely (finished, or not in the race). */
  hidden?: (id: string) => boolean;
  /** Treat as stale regardless of the snapshot age (a disconnected player). */
  offline?: (id: string) => boolean;
  /** The icon and start time (ms, `Date.now()`) of the player's newest emote. */
  emote?: (id: string) => { icon: string; at: number } | null;
}

const TAG_W = 256, TAG_H = 96;

/** One translucent avatar driven by snapshots. */
function GhostPlayer({ id, source, config, look, tagText }: {
  id: string; source: SnapshotSource; config: AvatarConfig; look: GhostLook; tagText: string | null;
}) {
  const root = useRef<Group>(null);
  const tagRef = useRef<Sprite>(null);
  const staleRef = useRef<Sprite>(null);
  const emoteRef = useRef<Sprite>(null);
  const pose = useMemo(() => makePose(), []);
  const out = useMemo(() => makeSampled(), []);
  const anim = useRef({ t: 0, foot: 0 });
  const mats = useRef<Material[]>([]);
  const shown = useRef(-1);
  const base = look.opacity ?? T.GHOST_OPACITY;

  // The name tag: one texture per player, in their body colour, released when they leave.
  const tag = useMemo(() => {
    if (tagText === null) return null;
    const bg = BODY_COLORS[config.body];
    const tex = labelTexture({ text: tagText, w: TAG_W, h: TAG_H, bg, fg: tagTextColor(bg), border: '#FFFFFF', radius: 30, maxLines: 1 });
    return { tex, mat: new SpriteMaterial({ map: tex, transparent: true, depthWrite: false }) };
  }, [tagText, config.body]);
  useEffect(() => () => { if (tag) { tag.mat.dispose(); releaseLabel(tag.tex); } }, [tag]);
  const staleMat = useMemo(() => new SpriteMaterial({ map: labelTexture({ text: '📶', w: 128, h: 96, maxLines: 1 }), transparent: true, depthWrite: false }), []);
  useEffect(() => () => staleMat.dispose(), [staleMat]);
  const emoteMat = useMemo(() => new SpriteMaterial({ transparent: true, depthWrite: false }), []);
  useEffect(() => () => emoteMat.dispose(), [emoteMat]);

  // Give this ghost its own see-through copies of the (shared, cached) avatar materials. `clone()` does not copy
  // `onBeforeCompile`, so the visibility (fog) fade is patched in again or rivals would be visible through the maze fog.
  useLayoutEffect(() => {
    const g = root.current;
    if (!g) return;
    const clones: Material[] = [];
    g.traverse((o) => {
      if (!(o instanceof Mesh) || Array.isArray(o.material)) return;
      const m = withVisibility(o.material.clone());
      m.transparent = true; m.opacity = base; m.depthWrite = false;
      o.material = m; o.castShadow = false;
      clones.push(m);
    });
    mats.current = clones;
    shown.current = -1;
    return () => { for (const m of clones) m.dispose(); mats.current = []; };
  }, [config, base]);

  useFrame((_, dtRaw) => {
    const g = root.current;
    if (!g) return;
    const s = sampleSnapshots(source.buffer(id), source.renderTime(), out);
    const hidden = !s || !!look.hidden?.(id);
    const stale = !!s && (s.stale || !!look.offline?.(id));
    g.visible = !hidden && (!stale || !!look.fadeWhenStale);
    if (!g.visible || !s) return;
    const dt = Math.min(dtRaw, 0.05), a = anim.current;
    a.t += dt;
    const k = Math.min(1, s.sp / T.MAX_SPEED);
    a.foot += dt * 14 * (stale ? 0 : 0.3 + k);
    g.position.set(s.x, s.y, s.z);
    g.rotation.y = s.f;
    pose.lean = MAX_LEAN * k;
    pose.waddle = Math.sin(a.t * 14) * 0.08 * k;
    pose.footPhase = a.foot;
    pose.squash = s.g ? 0 : 0.12;
    pose.spinAngle = s.spin * Math.PI * 2;

    const op = stale ? (look.staleOpacity ?? T.REMOTE_STALE_OPACITY) : base;
    if (op !== shown.current) { shown.current = op; for (const m of mats.current) m.opacity = op; }

    // tags fade with the maze visibility radius, like the junction signs
    const vis = visOpacity(s.x, s.z);
    const t = tagRef.current;
    if (t && tag) { t.visible = vis > 0.02; tag.mat.opacity = vis * (stale ? 0.6 : 1); }
    const sp = staleRef.current;
    if (sp) { sp.visible = stale && vis > 0.02; staleMat.opacity = vis; }
    const em = emoteRef.current;
    if (em) {
      const e = look.emote?.(id);
      const age = e ? Date.now() - e.at : Infinity;
      const on = !!e && age >= 0 && age < T.EMOTE_SHOW_MS && vis > 0.02;
      em.visible = on;
      if (on && e) {
        if (emoteMat.userData.icon !== e.icon) { emoteMat.map = labelTexture({ text: e.icon, w: 128, h: 128, bg: '#FFFFFF', maxLines: 1, radius: 60 }); emoteMat.userData.icon = e.icon; emoteMat.needsUpdate = true; }
        emoteMat.opacity = vis * Math.min(1, (T.EMOTE_SHOW_MS - age) / 400);
        em.position.y = 3.1 + Math.min(age, 600) / 1000 * 0.6;
      }
    }
  });

  return (
    <group ref={root} visible={false}>
      <Avatar config={config} pose={pose} />
      {tag && <sprite ref={tagRef} material={tag.mat} position={[0, 2.35, 0]} scale={[1.5, 0.56, 1]} />}
      <sprite ref={staleRef} material={staleMat} position={[0, 2.95, 0]} scale={[0.6, 0.45, 1]} visible={false} />
      <sprite ref={emoteRef} material={emoteMat} position={[0, 3.1, 0]} scale={[0.9, 0.9, 1]} visible={false} />
    </group>
  );
}

/** Draws every player in a snapshot source. F3 feeds it network snapshots; the daily feeds it the local ghost. */
export default function GhostPlayers({ source, look = {} }: { source: SnapshotSource; look?: GhostLook }) {
  const [, bump] = useState(0);
  useEffect(() => source.subscribe?.(() => bump((n) => n + 1)), [source]);
  return (
    <>
      {source.ids().map((id) => {
        const cfg = source.config(id);
        const tagText = look.tag ? look.tag(id) : null;
        return <GhostPlayer key={`${id}:${JSON.stringify(cfg)}:${tagText ?? ''}`} id={id} source={source} config={cfg} look={look} tagText={tagText} />;
      })}
    </>
  );
}
