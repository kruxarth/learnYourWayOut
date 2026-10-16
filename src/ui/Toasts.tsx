import { useUI } from './store';

export default function Toasts() {
  const toasts = useUI((s) => s.toasts);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.tone}`}>{t.tone === 'good' ? '✓ ' : t.tone === 'bad' ? '✗ ' : ''}{t.text}</div>
      ))}
    </div>
  );
}
