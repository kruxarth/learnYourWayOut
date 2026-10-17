import { useEffect, useRef, useState } from 'react';
import type { DomainPack } from '../content/schema';
import { customClient, TopicError } from '../content/customClient';
import { applyExcluded, excludedFor, loadRecent, removeRecent, saveRecent } from '../content/customStore';
import { EXAMPLE_PACKS } from '../content/examples';
import { setCustomPack } from '../content/source';
import { engine } from '../game/engine';
import { newSeed } from '../game/rng';
import type { Difficulty } from '../game/types';
import { useUI } from './store';
import { stageText } from './topicText';

const SUGGESTIONS = ['Roman Empire', 'Volcanoes', 'Solar System', 'Fractions', 'Rainforest animals', 'Python loops'];
const LEVELS: { id: Difficulty; label: string; sub: string }[] = [
  { id: 'easy', label: 'Easy', sub: 'beginner' },
  { id: 'normal', label: 'Medium', sub: 'intermediate' },
  { id: 'hard', label: 'Hard', sub: 'advanced' },
];

type Phase =
  | { kind: 'idle' }
  | { kind: 'working'; stage: string; progress: number }
  | { kind: 'done'; pack: DomainPack; level: Difficulty }
  | { kind: 'error'; error: TopicError };

type Server = 'checking' | 'up' | 'no-llm' | 'down';

/** Put the pack in the question source and start a run on it. Reported questions stay filtered out. */
function play(pack: DomainPack, level: Difficulty): void {
  const key = pack.generated?.packKey;
  setCustomPack(key ? applyExcluded(pack, excludedFor(key)) : pack);
  useUI.setState({ topicOpen: false });
  engine.startRun({ domainId: 'custom', difficulty: level, seed: newSeed() });
}

export default function TopicPanel() {
  const open = useUI((s) => s.topicOpen);
  if (!open) return null;
  return <TopicPanelBody />;
}

function TopicPanelBody() {
  const [topic, setTopic] = useState('');
  const [level, setLevel] = useState<Difficulty>(() => useUI.getState().topicLevel);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [server, setServer] = useState<Server>('checking');
  const [apiKey, setApiKey] = useState(''); // kept in memory only, never saved
  const [recent, setRecent] = useState<DomainPack[]>(() => loadRecent());
  const abort = useRef<AbortController | null>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    void customClient.checkServer(ctrl.signal).then((s) => {
      if (!ctrl.signal.aborted) setServer(!s.ok ? 'down' : s.llm ? 'up' : 'no-llm');
    });
    return () => { ctrl.abort(); abort.current?.abort(); };
  }, []);

  const close = () => { abort.current?.abort(); useUI.setState({ topicOpen: false }); };
  const working = phase.kind === 'working';
  const hasKey = apiKey.trim().length > 0;
  const serverOk = server === 'up' || (server === 'no-llm' && hasKey);
  const canMake = serverOk && topic.trim().length >= 3 && !working;

  const make = async (text = topic) => {
    const t = text.trim();
    if (t.length < 3 || !serverOk) return;
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setPhase({ kind: 'working', stage: 'checking', progress: 0 });
    try {
      const pack = await customClient.requestPack(t, level, (stage, progress) => {
        if (!ctrl.signal.aborted) setPhase({ kind: 'working', stage, progress });
      }, ctrl.signal, apiKey.trim() || undefined);
      if (ctrl.signal.aborted) return;
      saveRecent(pack);
      setRecent(loadRecent());
      setPhase({ kind: 'done', pack, level });
    } catch (e) {
      if (ctrl.signal.aborted || (e instanceof Error && e.name === 'AbortError')) return;
      setPhase({ kind: 'error', error: e instanceof TopicError ? e : new TopicError('failed', 'Something went wrong. Please try again.') });
    }
  };

  const pickSuggestion = (s: string) => { setTopic(s); setPhase({ kind: 'idle' }); };
  const showExample = (pack: DomainPack, lvl: Difficulty) => { setLevel(lvl); setPhase({ kind: 'done', pack, level: lvl }); };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
  };

  const err = phase.kind === 'error' ? phase.error : null;
  const serverMsg = server === 'down' || (server === 'no-llm' && !hasKey) ? 'Any Topic needs the game server. Try an example below!' : null;

  return (
    <div className="modal-back" role="dialog" aria-modal="true" aria-label="Any Topic" onKeyDown={onKey}>
      <div className="modal card topic-panel" ref={root}>
        <h2>Any Topic</h2>

        {phase.kind === 'done' ? (
          <DoneCard pack={phase.pack} level={phase.level} onBack={() => setPhase({ kind: 'idle' })} />
        ) : (
          <>
            <label className="topic-label" htmlFor="topic-input">What do you want to learn about?</label>
            <input
              id="topic-input" className="topic-input" type="text" maxLength={60} autoFocus autoComplete="off" spellCheck={false}
              value={topic} disabled={working} placeholder="e.g. Roman Empire"
              onChange={(e) => { setTopic(e.target.value); if (phase.kind === 'error') setPhase({ kind: 'idle' }); }}
              onKeyDown={(e) => { if (e.key === 'Enter' && canMake) void make(); }}
            />
            <div className="topic-note">
              Free demo: questions are written by free AI models, so it can be slow or fail when busy. Please don't use it for long play sessions.
            </div>
            <div className="chips topic-chips" aria-label="Topic ideas">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" className="chip" disabled={working} onClick={() => pickSuggestion(s)}>{s}</button>
              ))}
            </div>

            <h3>HOW HARD?</h3>
            <div className="chips" role="radiogroup" aria-label="Difficulty">
              {LEVELS.map((l) => (
                <button key={l.id} type="button" className="chip" role="radio" aria-checked={level === l.id} disabled={working} onClick={() => setLevel(l.id)}>
                  {l.label} <span className="chip-sub">({l.sub})</span>
                </button>
              ))}
            </div>

            <details className="topic-key">
              <summary>Busy or failing? Use your own free API key</summary>
              <input
                className="topic-input" type="password" autoComplete="off" spellCheck={false} maxLength={200}
                value={apiKey} disabled={working} placeholder="gsk_… (Groq), sk-or-… (OpenRouter) or csk-… (Cerebras)"
                aria-label="Your API key"
                onChange={(e) => { setApiKey(e.target.value); if (phase.kind === 'error') setPhase({ kind: 'idle' }); }}
              />
              <div className="topic-note">Sent only to make this one maze. It is never saved and not shown again. Free keys come from console.groq.com, openrouter.ai or cloud.cerebras.ai.</div>
            </details>

            {working && (
              <div className="topic-progress" role="status" aria-live="polite">
                <div>{stageText(phase.stage, phase.progress)}</div>
                <div className="bar"><div style={{ width: `${Math.max(4, phase.progress * 100)}%` }} /></div>
                <div className="topic-note">You can leave this open. It takes about half a minute.</div>
              </div>
            )}
            {serverMsg && !working && <div className="topic-error" role="alert">{serverMsg}</div>}
            {err && (
              <div className="topic-error" role="alert">
                {err.code === 'unsafe' ? "Let's pick a different topic!" : err.message}
                {err.suggestions.length > 0 && (
                  <div className="chips topic-chips">
                    {err.suggestions.map((s) => <button key={s} type="button" className="chip" onClick={() => pickSuggestion(s)}>{s}</button>)}
                  </div>
                )}
              </div>
            )}

            <div className="row">
              {!working && <button className="btn primary" disabled={!canMake} onClick={() => void make()}>{err && err.code === 'failed' ? 'Retry' : 'Make my maze'}</button>}
              {working && <button className="btn" onClick={() => { abort.current?.abort(); setPhase({ kind: 'idle' }); }}>Cancel</button>}
              <button className="btn" onClick={close}>Close (Esc)</button>
            </div>

            <h3>TRY AN EXAMPLE (WORKS OFFLINE)</h3>
            <div className="chips">
              {EXAMPLE_PACKS.map((x) => (
                <button key={x.label} type="button" className="chip" disabled={working} onClick={() => showExample(x.pack, x.level)}>
                  {x.label} · {LEVELS.find((l) => l.id === x.level)!.label}
                </button>
              ))}
            </div>

            {recent.length > 0 && (
              <>
                <h3>RECENT TOPICS</h3>
                <ul className="topic-recent">
                  {recent.map((p) => (
                    <li key={p.generated!.packKey}>
                      <span className="name">{p.name}</span>
                      <span className="lvl">{LEVELS.find((l) => l.id === p.topic?.level)?.label ?? 'Medium'}</span>
                      <button type="button" className="btn" disabled={working} onClick={() => play(p, p.topic?.level ?? 'normal')}>Play</button>
                      <button type="button" className="btn" aria-label={`Remove ${p.name}`} disabled={working}
                        onClick={() => { removeRecent(p.generated!.packKey); setRecent(loadRecent()); }}>✕</button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function DoneCard({ pack, level, onBack }: { pack: DomainPack; level: Difficulty; onBack: () => void }) {
  const lvl = LEVELS.find((l) => l.id === level)!;
  const handWritten = pack.generated?.model === 'hand-written';
  return (
    <div className="topic-done">
      <div className="topic-title" style={{ background: pack.color }}>{pack.name}</div>
      <div className="topic-note">{lvl.label} · {pack.questions.length} questions · {handWritten ? 'Example pack, checked by a person' : '✨ AI-made, so it may have mistakes. Use ⚑ to report one.'}</div>
      <ul className="topic-concepts">
        {pack.concepts.map((c) => (
          <li key={c.id}><strong>{c.name}</strong>{c.facts?.[0] && <span>{c.facts[0]}</span>}</li>
        ))}
      </ul>
      <div className="row">
        <button className="btn primary" autoFocus onClick={() => play(pack, level)}>Start run</button>
        <button className="btn" onClick={onBack}>Back</button>
      </div>
    </div>
  );
}
