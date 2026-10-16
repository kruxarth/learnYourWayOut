import { randomUUID } from 'node:crypto';
import type { DomainPack } from '../src/content/schema';
import type { PackErrorCode, Stage } from './llm/pipeline';

export interface Job {
  id: string;
  key: string;
  stage: Stage;
  progress: number;
  pack?: DomainPack;
  error?: { code: PackErrorCode; message: string; suggestions?: string[] };
  createdAt: number;
}

/** In-memory job map with a TTL (10 minutes by default). Time is injected for tests. */
export class JobStore {
  private readonly jobs = new Map<string, Job>();
  constructor(
    private readonly now: () => number = Date.now,
    private readonly ttlMs = 10 * 60_000,
    private readonly newId: () => string = randomUUID,
  ) {}

  create(key: string): Job {
    this.purge();
    const job: Job = { id: this.newId(), key, stage: 'checking', progress: 0, createdAt: this.now() };
    this.jobs.set(job.id, job);
    return job;
  }

  get(id: string): Job | null {
    this.purge();
    return this.jobs.get(id) ?? null;
  }

  /** A job for the same key that is still running, so two players asking for one topic share the work. */
  findActive(key: string): Job | null {
    this.purge();
    for (const j of this.jobs.values()) if (j.key === key && j.stage !== 'done' && j.stage !== 'failed') return j;
    return null;
  }

  private purge(): void {
    const cutoff = this.now() - this.ttlMs;
    for (const [id, j] of this.jobs) if (j.createdAt < cutoff) this.jobs.delete(id);
  }
}
