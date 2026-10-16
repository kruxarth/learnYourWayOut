import { useUI } from './store';

export default function Banner() {
  const banner = useUI((s) => s.banner);
  if (!banner) return null;
  return <div key={banner.id} className={`banner big-title ${banner.tone}`} role="alert">{banner.text}</div>;
}
