import { describe, expect, it } from 'vitest';
import { RateBucket, STATE_PER_SEC } from './ws';

describe('RateBucket', () => {
  it('allows a burst up to the rate, drops extras, and refills with the clock', () => {
    const clock = { t: 0 };
    const b = new RateBucket(STATE_PER_SEC, () => clock.t);
    let ok = 0;
    for (let i = 0; i < 40; i++) if (b.allow()) ok++;
    expect(ok).toBe(STATE_PER_SEC);
    clock.t += 1000;
    ok = 0;
    for (let i = 0; i < 40; i++) if (b.allow()) ok++;
    expect(ok).toBe(STATE_PER_SEC);
    clock.t += 200;
    expect(b.allow()).toBe(true);
  });
});
