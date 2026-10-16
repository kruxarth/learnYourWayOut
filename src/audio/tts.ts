import type { Emitter, GameEvent } from '../game/events';
import { G } from '../game/state';
import { useUI } from '../ui/store';

/** Read-aloud (spec §19.2, P1): speechSynthesis, one utterance at a time. */
function supported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
}

export function speak(text: string): void {
  if (!supported()) return;
  const clean = text.replace(/`/g, '').replace(/→/g, 'then');
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(clean);
  u.rate = 1.0;
  window.speechSynthesis.speak(u);
}

/** True while an utterance is playing (answer timers wait for it). */
export function isSpeaking(): boolean {
  return supported() && window.speechSynthesis.speaking;
}

export function stopSpeaking(): void {
  if (supported()) window.speechSynthesis.cancel();
}

/** Read the question of the active room, or board A of the detour. */
export function readCurrent(): void {
  const run = G.run;
  if (!run) return;
  if (run.detour) {
    const q = run.detour.question;
    speak(`Not quite. ${q.explanation}`);
    return;
  }
  const room = run.activeRoomId ? run.roomMap.get(run.activeRoomId) : null;
  if (room?.question) speak(room.question.type === 'truefalse' ? `${room.question.prompt} True or false?` : room.question.prompt);
}

export const tts = {
  attach(events: Emitter<GameEvent>): void {
    events.on((e) => {
      if (!useUI.getState().settings.readAloud) return;
      if (e.type === 'roomActivated') setTimeout(readCurrent, 150);
      else if (e.type === 'detourEnter') setTimeout(readCurrent, 700);
    });
  },
};
