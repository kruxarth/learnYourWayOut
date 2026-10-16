import { useUI } from './store';

export default function FadeLayer() {
  const fade = useUI((s) => s.fade);
  const lost = useUI((s) => s.lost);
  return (
    <>
      <div className={`fade${fade ? ' on' : ''}`} />
      {lost && <div className="tint-lost" />}
    </>
  );
}
