import { T } from '../game/tuning';
import { nameTagText, EMOTES } from '../net/race';
import { emotes, net, remotes, useNet } from '../net/store';
import GhostPlayers, { type GhostLook } from './GhostPlayers';

/** Other players in an online race: the F1 avatar at 85% opacity, 150 ms in the past, with a name tag. Mounted only for online runs. */
const look: GhostLook = {
  opacity: T.REMOTE_OPACITY,
  fadeWhenStale: true,
  tag: (id) => nameTagText(remotes.get(id)?.name ?? ''),
  hidden: (id) => !!useNet.getState().finishes[id],
  offline: (id) => remotes.get(id)?.connected === false,
  emote: (id) => {
    const e = emotes.get(id);
    return e ? { icon: EMOTES[e.id]?.icon ?? '👋', at: e.at } : null;
  },
};

export default function RemotePlayers() {
  return <GhostPlayers source={net.source} look={look} />;
}
