import { useEffect, useState } from 'react';
import { T } from '../game/tuning';
import { EMOTES, emoteForKey } from '../net/race';
import { net, useNet } from '../net/store';

/** Online emotes: keys 6-9 or these four buttons. 3 s client cooldown; my own icon floats above the bar for 2 s. */
export default function EmoteBar() {
  const mine = useNet((s) => s.myEmote);
  // the cooldown is over once the timer has marked this emote number as cooled
  const [cooledN, setCooledN] = useState(-1);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const id = emoteForKey(e.code);
      if (id >= 0) net.emote(id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!mine) return;
    const id = setTimeout(() => setCooledN(mine.n), T.EMOTE_COOLDOWN_MS);
    return () => clearTimeout(id);
  }, [mine]);

  const cool = !!mine && cooledN !== mine.n;
  return (
    <div className="emote-bar">
      {mine && <div className="emote-float" key={mine.n} aria-hidden="true">{EMOTES[mine.id].icon}</div>}
      <div className="emote-btns" role="group" aria-label="Emotes">
        {EMOTES.map((e) => (
          <button key={e.id} type="button" className="btn emote-btn" disabled={cool} aria-label={`${e.label} (key ${e.key})`}
            title={`${e.label} (${e.key})`} onClick={(ev) => { ev.currentTarget.blur(); net.emote(e.id); }}>{e.icon}</button>
        ))}
      </div>
    </div>
  );
}
