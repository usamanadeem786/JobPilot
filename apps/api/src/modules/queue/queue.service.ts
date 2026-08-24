import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Queue, Worker, type Job } from 'bullmq';
import IORedis, { type Redis } from 'ioredis';
import { ENV, type Env } from '../../config/config.module';

/**
 * Background work.
 *
 * A discovery search fetches every configured board in turn, politely rate
 * limited, and takes tens of seconds. Running that inside the request means
 * the browser holds a connection open the whole time, a proxy may time it out
 * at 30 seconds, and a serverless host will kill it outright.
 *
 * Redis is optional, and that shapes the design. When `REDIS_URL` is set the
 * work goes to BullMQ and survives a restart; when it is not, it runs in this
 * process instead. Both paths are behind one interface, so nothing that
 * enqueues work knows or cares which is in use — and a deployment without
 * Redis is degraded rather than broken.
 */

export type JobHandler<TPayload> = (payload: TPayload, jobId: string) => Promise<void>;

export interface QueueBackend {
  readonly kind: 'redis' | 'in-process';
  add<TPayload>(name: string, payload: TPayload): Promise<string>;
  process<TPayload>(name: string, handler: JobHandler<TPayload>): void;
  close(): Promise<void>;
}

/** Names are shared by the producer and the consumer; typos here are silent. */
export const SEARCH_JOB = 'job-search';

@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private readonly backend: QueueBackend;

  constructor(@Inject(ENV) private readonly env: Env) {
    this.backend = env.REDIS_URL
      ? new RedisBackend(env.REDIS_URL, this.logger)
      : new InProcessBackend(this.logger);

    this.logger.log(
      this.backend.kind === 'redis'
        ? 'Background work is queued in Redis.'
        : 'No REDIS_URL is set, so background work runs in this process and does not survive a restart.',
    );
  }

  get kind(): 'redis' | 'in-process' {
    return this.backend.kind;
  }

  async add<TPayload>(name: string, payload: TPayload): Promise<string> {
    return this.backend.add(name, payload);
  }

  process<TPayload>(name: string, handler: JobHandler<TPayload>): void {
    this.backend.process(name, handler);
  }

  async onModuleDestroy(): Promise<void> {
    await this.backend.close();
  }
}

class RedisBackend implements QueueBackend {
  readonly kind = 'redis' as const;

  private readonly connection: Redis;
  private readonly queues = new Map<string, Queue>();
  private readonly workers: Worker[] = [];

  constructor(
    url: string,
    private readonly logger: Logger,
  ) {
    this.connection = new IORedis(url, {
      // BullMQ blocks on reads, so it requires retries to be unlimited rather
      // than the ioredis default. Without this the worker stops consuming
      // after a brief network blip and nothing says why.
      maxRetriesPerRequest: null,
    });

    this.connection.on('error', (error: Error) => {
      this.logger.warn(`Redis connection error: ${error.message}`);
    });
  }

  private queueFor(name: string): Queue {
    const existing = this.queues.get(name);
    if (existing) return existing;

    const queue = new Queue(name, { connection: this.connection });
    this.queues.set(name, queue);
    return queue;
  }

  async add<TPayload>(name: string, payload: TPayload): Promise<string> {
    const job = await this.queueFor(name).add(name, payload, {
      removeOnComplete: { count: 100 },
      // Failures are kept longer than successes: a completed job tells you
      // nothing you cannot see in the data, a failed one is the only record
      // of what went wrong.
      removeOnFail: { count: 500 },
      attempts: 2,
      backoff: { type: 'exponential', delay: 5_000 },
    });

    return job.id ?? '';
  }

  process<TPayload>(name: string, handler: JobHandler<TPayload>): void {
    const worker = new Worker(
      name,
      async (job: Job<TPayload>) => {
        await handler(job.data, job.id ?? '');
      },
      {
        connection: this.connection,
        // One at a time. Every source is rate limited, and running searches
        // in parallel would multiply the request rate against job boards by
        // the concurrency and get the deployment blocked.
        concurrency: 1,
      },
    );

    worker.on('failed', (job, error) => {
      this.logger.warn(`Job ${job?.id ?? '?'} on ${name} failed: ${error.message}`);
    });

    this.workers.push(worker);
  }

  async close(): Promise<void> {
    await Promise.all(this.workers.map((worker) => worker.close()));
    await Promise.all([...this.queues.values()].map((queue) => queue.close()));
    this.connection.disconnect();
  }
}

/**
 * The fallback when there is no Redis.
 *
 * Runs each job on the next tick, one at a time, in this process. Work is lost
 * on restart and does not spread across instances — which is exactly why Redis
 * is the production answer — but a single-instance deployment behaves
 * correctly, and the request still returns immediately.
 */
class InProcessBackend implements QueueBackend {
  readonly kind = 'in-process' as const;

  private readonly handlers = new Map<string, JobHandler<unknown>>();
  private readonly pending: { name: string; payload: unknown; id: string }[] = [];
  private running = false;
  private closed = false;
  private counter = 0;

  constructor(private readonly logger: Logger) {}

  add<TPayload>(name: string, payload: TPayload): Promise<string> {
    this.counter += 1;
    const id = `local-${this.counter}`;
    this.pending.push({ name, payload, id });

    // Deliberately not awaited: `add` returns as soon as the work is queued,
    // which is the whole point of queueing it.
    void this.drain();

    return Promise.resolve(id);
  }

  process<TPayload>(name: string, handler: JobHandler<TPayload>): void {
    this.handlers.set(name, handler as JobHandler<unknown>);
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.running || this.closed) return;
    this.running = true;

    try {
      while (this.pending.length > 0 && !this.closed) {
        const next = this.pending[0];
        if (!next) break;

        const handler = this.handlers.get(next.name);
        // No handler registered yet — leave it queued rather than dropping it.
        if (!handler) break;

        this.pending.shift();

        try {
          await handler(next.payload, next.id);
        } catch (error) {
          this.logger.warn(
            `Job ${next.id} on ${next.name} failed: ${error instanceof Error ? error.message : 'unknown error'}`,
          );
        }
      }
    } finally {
      this.running = false;
    }
  }

  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }
}
