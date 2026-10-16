import { describe, expect, it } from 'vitest';
import { ADJECTIVES, ANIMALS, cleanName, randomName } from '../game/names';
import { hasProfanity } from '../game/profanity';
import { mulberry32 } from '../game/rng';

const ZW = String.fromCharCode(0x200b);
const BIDI = String.fromCharCode(0x202e);

describe('cleanName', () => {
  it('trims and collapses spaces', () => {
    expect(cleanName('  Curious    Otter  ')).toEqual({ ok: true, name: 'Curious Otter' });
    expect(cleanName('a\t\nb')).toEqual({ ok: true, name: 'a b' });
  });

  it('rejects names that are too short or too long', () => {
    expect(cleanName('a')).toEqual({ ok: false, reason: 'too-short' });
    expect(cleanName('   ')).toEqual({ ok: false, reason: 'too-short' });
    expect(cleanName('abcdefghijklmnop')).toMatchObject({ ok: true });
    expect(cleanName('abcdefghijklmnopq')).toEqual({ ok: false, reason: 'too-long' });
  });

  it('strips zero-width and bidi tricks', () => {
    expect(cleanName(`a${ZW}b`)).toEqual({ ok: true, name: 'ab' });
    expect(cleanName(`${BIDI}Sam`)).toEqual({ ok: true, name: 'Sam' });
    expect(cleanName(`s${ZW}h${ZW}i${ZW}t`)).toEqual({ ok: false, reason: 'not-allowed' });
  });

  it('rejects emoji, symbols and punctuation-only names', () => {
    expect(cleanName('Sam 🙂')).toEqual({ ok: false, reason: 'not-allowed' });
    expect(cleanName('<b>Sam</b>')).toEqual({ ok: false, reason: 'not-allowed' });
    expect(cleanName('..')).toEqual({ ok: false, reason: 'not-allowed' });
    expect(cleanName('🙂🙂')).toEqual({ ok: false, reason: 'not-allowed' });
  });

  it('accepts non-English names and allowed punctuation', () => {
    for (const n of ['Ananya', 'José', 'अर्जुन', 'Zoë-Ann', "O'Neil", 'Mr. Bean', 'x_y 2']) {
      expect(cleanName(n)).toMatchObject({ ok: true });
    }
  });

  it('blocks profanity, including leet-speak and separators', () => {
    for (const n of ['fuck', 'F u c k', 'sh1t', '$h!t', 'b1tch', 'f.u.c.k', 'SHIT2', 'madarchod', 'Mad4rch0d', 'chutiya']) {
      expect(cleanName(n)).toEqual({ ok: false, reason: 'not-allowed' });
    }
  });

  it('does not block innocent look-alikes', () => {
    for (const n of ['Classic', 'Grass', 'Assist', 'Blunder', 'Skill', 'Therapist', 'Sussex', 'Scunthorpe', 'Claudia', 'Salad']) {
      expect(hasProfanity(n), n).toBe(false);
    }
  });
});

describe('randomName', () => {
  it('every adjective and animal combination passes cleanName', () => {
    for (const a of ADJECTIVES) for (const b of ANIMALS) {
      const r = cleanName(`${a} ${b}`);
      expect(r.ok, `${a} ${b}`).toBe(true);
    }
  });

  it('is deterministic for a seed and produces two words', () => {
    expect(randomName(mulberry32(3))).toBe(randomName(mulberry32(3)));
    const rng = mulberry32(9);
    for (let i = 0; i < 50; i++) {
      const n = randomName(rng);
      expect(n.split(' ')).toHaveLength(2);
      expect(cleanName(n)).toEqual({ ok: true, name: n });
    }
  });
});
