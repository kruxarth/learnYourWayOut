import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DomainPack } from '../src/content/schema';
import { validateDomainPack } from '../src/content/validate';

/** LRU in memory (50) plus, when `dir` is set, one JSON file per pack: <sha1(key)>.json. */
export class PackCache {
  private readonly mem = new Map<string, DomainPack>();
  private readonly max: number;
  private dir: string | null;
  constructor(opts: { max?: number; dir?: string | null } = {}) {
    this.max = opts.max ?? 50;
    this.dir = opts.dir ?? null;
    if (this.dir) {
      try { mkdirSync(this.dir, { recursive: true }); } catch { this.dir = null; }
    }
  }

  private file(key: string): string | null {
    return this.dir ? join(this.dir, `${createHash('sha1').update(key).digest('hex')}.json`) : null;
  }

  get(key: string): DomainPack | null {
    const hit = this.mem.get(key);
    if (hit) { this.mem.delete(key); this.mem.set(key, hit); return hit; }
    const f = this.file(key);
    if (f && existsSync(f)) {
      try {
        const pack = JSON.parse(readFileSync(f, 'utf8')) as DomainPack;
        // never trust a file on disk: it must still pass the quotas and carry the same key
        if (pack.generated?.packKey === key && validateDomainPack(pack).length === 0) { this.remember(key, pack); return pack; }
      } catch { /* corrupt file: treat as a miss */ }
    }
    return null;
  }

  set(key: string, pack: DomainPack): void {
    this.remember(key, pack);
    const f = this.file(key);
    if (f) {
      try { writeFileSync(f, JSON.stringify(pack)); } catch { /* the memory copy still works */ }
    }
  }

  /** Drop one question from the cached pack. If the quotas would break, the whole pack is dropped. */
  removeQuestion(key: string, questionId: string): 'removed' | 'pack-dropped' | 'not-found' {
    const pack = this.get(key);
    if (!pack || !pack.questions.some((q) => q.id === questionId)) return 'not-found';
    const next: DomainPack = { ...pack, questions: pack.questions.filter((q) => q.id !== questionId) };
    if (validateDomainPack(next).length === 0) { this.set(key, next); return 'removed'; }
    this.mem.delete(key);
    const f = this.file(key);
    if (f) {
      try { unlinkSync(f); } catch { /* already gone */ }
    }
    return 'pack-dropped';
  }

  private remember(key: string, pack: DomainPack): void {
    this.mem.delete(key);
    this.mem.set(key, pack);
    while (this.mem.size > this.max) this.mem.delete(this.mem.keys().next().value as string);
  }
}
