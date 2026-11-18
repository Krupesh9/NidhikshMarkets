import { log } from './log';

/** In-process job queue interface (swap for BullMQ + Redis in phase two). */
export interface Job<T = unknown> { id: string; name: string; data: T; attempts: number; createdAt: number }
export type JobHandler<T = unknown> = (job: Job<T>) => Promise<void>;

export interface JobQueue {
  register<T>(name: string, handler: JobHandler<T>): void;
  enqueue<T>(name: string, data: T, opts?: { delayMs?: number; maxAttempts?: number }): string;
  size(): number;
}

class InProcessQueue implements JobQueue {
  private handlers = new Map<string, JobHandler<any>>(); // eslint-disable-line @typescript-eslint/no-explicit-any
  private pending = 0;
  register<T>(name: string, handler: JobHandler<T>) { this.handlers.set(name, handler); }
  enqueue<T>(name: string, data: T, opts: { delayMs?: number; maxAttempts?: number } = {}) {
    const job: Job<T> = { id: `${name}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, name, data, attempts: 0, createdAt: Date.now() };
    const max = opts.maxAttempts ?? 3;
    const run = async () => {
      const h = this.handlers.get(name);
      if (!h) { log.warn('jobs.no_handler', { name }); this.pending--; return; }
      job.attempts++;
      try { await h(job); this.pending--; }
      catch (e) {
        log.warn('jobs.failed', { name, id: job.id, attempt: job.attempts, err: (e as Error).message });
        if (job.attempts < max) setTimeout(run, 2 ** job.attempts * 500);
        else this.pending--;
      }
    };
    this.pending++;
    setTimeout(run, opts.delayMs ?? 0);
    return job.id;
  }
  size() { return this.pending; }
}

const g = globalThis as unknown as { __ndJobs?: JobQueue };
export const jobs: JobQueue = g.__ndJobs ?? (g.__ndJobs = new InProcessQueue());
