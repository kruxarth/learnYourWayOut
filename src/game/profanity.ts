// A small blocklist of common English and Hindi (romanised) swear words, so the obvious word does not show on a projector.
// It will never be complete. Words of 6+ letters match anywhere in the name (separators removed); shorter ones only as a whole word.
export const PROFANITY: string[] = [
  // English
  'fuck', 'fucker', 'fucking', 'fck', 'fuk', 'shit', 'shite', 'bullshit', 'bitch', 'bastard', 'asshole', 'arsehole', 'ass', 'arse',
  'dick', 'dickhead', 'cock', 'cocksucker', 'pussy', 'cunt', 'twat', 'slut', 'whore', 'hoe', 'wank', 'wanker', 'tits', 'boobs',
  'porn', 'porno', 'sex', 'sexy', 'rape', 'nazi', 'hitler', 'nigger', 'nigga', 'fag', 'faggot', 'retard', 'spastic',
  'dyke', 'tranny', 'damn', 'crap', 'piss', 'douche', 'jerkoff', 'blowjob', 'handjob', 'cum', 'jizz', 'horny', 'nude', 'nudes',
  'kill', 'suicide', 'molest', 'pedo', 'paedo', 'terrorist', 'isis', 'kkk', 'milf', 'anal', 'anus', 'penis', 'vagina', 'dildo',
  // Hindi / Hinglish
  'chutiya', 'chutiye', 'chut', 'madarchod', 'maderchod', 'mc', 'bhenchod', 'behenchod', 'bhosdike', 'bhosdi', 'bhosda', 'bc',
  'gandu', 'gaandu', 'gaand', 'gand', 'lund', 'lauda', 'lavda', 'loda', 'randi', 'raand', 'harami', 'haramkhor', 'kutta', 'kutti',
  'kamina', 'kamine', 'saala', 'sala', 'bakchod', 'bakchodi', 'chod', 'chodu', 'tatti', 'jhant', 'jhatu',
  'launda', 'suar', 'ullu',
];

const WHOLE_WORD_ONLY = (w: string) => w.length < 6;

export const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '@': 'a', '$': 's', '!': 'i', '7': 't' };

function fold(s: string): string {
  let out = '';
  for (const ch of s) out += LEET[ch] ?? ch;
  return out;
}

/** True if the name contains a listed word (case, leet-speak and separators ignored). */
export function hasProfanity(name: string): boolean {
  const lower = name.toLowerCase();
  // two views: digits read as letters (sh1t), and digits dropped (shit2)
  for (const view of [fold(lower), lower.replace(/[0-9]/g, '')]) {
    const tokens = view.split(/[^\p{L}]+/u).filter(Boolean);
    const compact = tokens.join('');
    for (const w of PROFANITY) {
      if (WHOLE_WORD_ONLY(w)) {
        if (tokens.includes(w) || compact === w) return true;
      } else if (compact.includes(w)) return true;
    }
  }
  return false;
}
