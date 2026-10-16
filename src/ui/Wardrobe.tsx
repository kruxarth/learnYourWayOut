import { useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import {
  catalogFor, isUnlocked, randomAvatar, sanitizeAvatar, unlockText, type AvatarConfig, type CatalogItem, type Slot,
} from '../game/avatar';
import { cleanName, nameError, randomName } from '../game/names';
import { BODY_COLORS } from '../game/palette';
import { loadProgress, saveAvatar, savePlayerName } from '../game/persistence';
import { mulberry32, newSeed } from '../game/rng';
import Avatar, { Spinner } from '../render/avatar/Avatar';
import { makePose } from '../render/avatar/pose';
import { useUI } from './store';

type Tab = 'colour' | 'face' | 'hat' | 'extra';
const TABS: { id: Tab; label: string; slots: { slot: Slot; title: string }[] }[] = [
  { id: 'colour', label: 'Colour', slots: [{ slot: 'body', title: 'BODY COLOUR' }] },
  { id: 'face', label: 'Face', slots: [{ slot: 'eyes', title: 'EYES' }, { slot: 'mouth', title: 'MOUTH' }] },
  { id: 'hat', label: 'Hat', slots: [{ slot: 'hat', title: 'HAT' }] },
  { id: 'extra', label: 'Extra', slots: [{ slot: 'extra', title: 'EXTRA' }] },
];

function setAvatar(next: AvatarConfig): void {
  const clean = sanitizeAvatar(next);
  useUI.setState({ avatar: clean });
  saveAvatar(clean);
}

function setPlayerName(name: string): void {
  useUI.setState({ playerName: name });
  savePlayerName(name);
}

function PreviewCanvas({ config }: { config: AvatarConfig }) {
  const pose = useMemo(() => makePose(), []);
  return (
    <Canvas dpr={[1, 2]} flat camera={{ fov: 30, position: [0, 1.4, 6.4], near: 0.1, far: 30 }}>
      <hemisphereLight args={['#CFEFFF', '#FFE2C4', 1.6]} />
      <directionalLight position={[3, 5, 4]} intensity={2.2} />
      <Spinner><Avatar config={config} pose={pose} /></Spinner>
    </Canvas>
  );
}

function Item({ item, selected, locked, onPick }: { item: CatalogItem; selected: boolean; locked: boolean; onPick: () => void }) {
  return (
    <button
      className={`chip wd-item${locked ? ' locked' : ''}`}
      role="radio"
      aria-checked={selected}
      aria-disabled={locked}
      title={locked ? unlockText(item.unlock) : item.name}
      onClick={() => { if (!locked) onPick(); }}
    >
      {item.slot === 'body' && <span className="swatch" style={{ background: BODY_COLORS[item.id as keyof typeof BODY_COLORS] }} />}
      <span>{locked ? '🔒 ' : ''}{item.name}</span>
      {locked && <small>{unlockText(item.unlock)}</small>}
    </button>
  );
}

export default function Wardrobe() {
  const open = useUI((s) => s.wardrobeOpen);
  if (!open) return null;
  return <WardrobePanel />;
}

function WardrobePanel() {
  const avatar = useUI((s) => s.avatar);
  const playerName = useUI((s) => s.playerName);
  const [tab, setTab] = useState<Tab>('colour');
  const progress = useMemo(() => loadProgress(), []);
  const [draft, setDraft] = useState(playerName ?? '');
  const [error, setError] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const cur = TABS.find((t) => t.id === tab)!;

  const onKey = (e: React.KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement) return;
    const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
    if (!keys.includes(e.key)) return;
    const els = Array.from(root.current?.querySelectorAll<HTMLButtonElement>('button') ?? []);
    const i = els.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    e.preventDefault();
    const next = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? i - 1 : i + 1;
    els[(next + els.length) % els.length]?.focus();
  };

  const commitName = (raw: string) => {
    setDraft(raw);
    const r = cleanName(raw);
    if (r.ok) { setError(''); setPlayerName(r.name); } else setError(nameError(r.reason));
  };
  const suggest = () => commitName(randomName(mulberry32(newSeed())));
  const randomise = () => setAvatar(randomAvatar(progress, mulberry32(newSeed())));

  return (
    <div className="modal-back" role="dialog" aria-modal="true" aria-label="Wardrobe">
      <div className="modal card wardrobe" ref={root} onKeyDown={onKey}>
        <h2>Wardrobe</h2>
        <div className="wd-body">
          <div className="wd-preview" aria-label="Preview of your character"><PreviewCanvas config={avatar} /></div>
          <div className="wd-side">
            <div className="chips" role="tablist" aria-label="Wardrobe sections">
              {TABS.map((t) => (
                <button key={t.id} className="chip" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} autoFocus={t.id === 'colour'}>{t.label}</button>
              ))}
            </div>
            {cur.slots.map(({ slot, title }) => (
              <div key={slot}>
                <h3>{title}</h3>
                <div className="chips" role="radiogroup" aria-label={title}>
                  {catalogFor(slot).map((item) => (
                    <Item
                      key={item.id}
                      item={item}
                      selected={avatar[slot] === item.id}
                      locked={!isUnlocked(item, progress)}
                      onPick={() => setAvatar({ ...avatar, [slot]: item.id })}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
        <h3>YOUR NAME</h3>
        <div className="wd-name">
          <input
            type="text" value={draft} maxLength={16} aria-label="Your name" aria-invalid={!!error}
            onChange={(e) => commitName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          />
          <button className="btn" onClick={suggest} aria-label="Suggest a random name" title="Suggest a name">🎲</button>
        </div>
        <div className="wd-error" role="status">{error}</div>
        <div className="row">
          <button className="btn" onClick={randomise}>🎲 Randomise</button>
          <button className="btn primary" onClick={() => useUI.setState({ wardrobeOpen: false })}>Done (Esc)</button>
        </div>
      </div>
    </div>
  );
}

/** One-time "What should we call you?" prompt, pre-filled so Enter just works. */
export function NamePrompt() {
  const open = useUI((s) => s.namePromptOpen);
  const [draft, setDraft] = useState(() => randomName(mulberry32(newSeed())));
  const [error, setError] = useState('');
  if (!open) return null;
  const submit = () => {
    const r = cleanName(draft);
    if (!r.ok) { setError(nameError(r.reason)); return; }
    setPlayerName(r.name);
    useUI.setState({ namePromptOpen: false });
  };
  return (
    <div className="modal-back" role="dialog" aria-modal="true" aria-label="Your name">
      <form className="modal card" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <h2>What should we call you?</h2>
        <div className="wd-name">
          <input type="text" value={draft} maxLength={16} autoFocus aria-label="Your name" aria-invalid={!!error}
            onChange={(e) => { setDraft(e.target.value); setError(''); }} />
          <button type="button" className="btn" onClick={() => setDraft(randomName(mulberry32(newSeed())))} aria-label="Suggest a random name" title="Suggest a name">🎲</button>
        </div>
        <div className="wd-error" role="status">{error}</div>
        <div className="row"><button type="submit" className="btn primary">Let&apos;s go</button></div>
      </form>
    </div>
  );
}
