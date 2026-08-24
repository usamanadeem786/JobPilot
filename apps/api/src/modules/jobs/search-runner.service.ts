import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { NormalisedQuery } from '@jobpilot/job-sources';
import type { Prisma } from '@jobpilot/database';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService, SEARCH_JOB } from '../queue/queue.service';
import { JobIngestionService } from './job-ingestion.service';

export interface SearchJobPayload {
  readonly userId: string;
  readonly searchId: string;
  readonly query: NormalisedQuery;
  readonly onlySources?: readonly string[];
}

export interface SearchProgress {
  readonly status: 'queued' | 'running' | 'completed' | 'failed';
  readonly stage: string;
  readonly found: number;
  readonly addedToUser: number;
  readonly sourcesDone: string[];
  readonly error: string | null;
}

/**
 * Runs a discovery search in the background and records its progress.
 *
 * A search fetches every configured board in turn, politely rate limited, and
 * routinely takes half a minute. Holding the HTTP request open for that is
 * what makes proxies time out at thirty seconds and serverless hosts kill the
 * process mid-fetch — and it gives the user a spinner with nothing behind it.
 *
 * Progress is written to the search row rather than held in memory, so the
 * client polls or streams it from the database and any instance can answer.
 * That is what lets the Redis-backed queue run the work on a different machine
 * from the one serving the browser.
 */
@Injectable()
export class SearchRunnerService implements OnModuleInit {
  private readonly logger = new Logger(SearchRunnerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    private readonly ingestion: JobIngestionService,
  ) {}

  onModuleInit(): void {
    this.queue.process<SearchJobPayload>(SEARCH_JOB, async (payload) => {
      await this.run(payload);
    });
  }

  /** Queues a search and returns immediately with its id. */
  async enqueue(
    userId: string,
    query: NormalisedQuery,
    onlySources?: readonly string[],
  ): Promise<{ searchId: string }> {
    const search = await this.prisma.jobSearch.create({
      data: {
        userId,
        name: query.keywords,
        keywords: query.keywords.split(/\s+/).filter(Boolean),
        filters: {
          ...(query.location ? { location: query.location } : {}),
          ...(query.remoteOnly ? { remoteOnly: true } : {}),
          ...(query.minSalary === undefined ? {} : { minSalary: query.minSalary }),
          limit: query.limit,
        } as Prisma.InputJsonValue,
        sourceKeys: onlySources ? [...onlySources] : [],
        status: 'QUEUED',
        progress: {
          status: 'queued',
          stage: 'Waiting to start',
          found: 0,
          addedToUser: 0,
          sourcesDone: [],
          error: null,
        } satisfies SearchProgress as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });

    const queueJobId = await this.queue.add<SearchJobPayload>(SEARCH_JOB, {
      userId,
      searchId: search.id,
      query,
      ...(onlySources ? { onlySources } : {}),
    });

    await this.prisma.jobSearch.update({
      where: { id: search.id },
      data: { queueJobId },
    });

    return { searchId: search.id };
  }

  async progressOf(userId: string, searchId: string): Promise<SearchProgress | null> {
    const row = await this.prisma.jobSearch.findFirst({
      where: { id: searchId, userId },
      select: { progress: true, status: true },
    });

    if (!row) return null;

    const progress = row.progress as SearchProgress | null;
    return (
      progress ?? {
        status: 'queued',
        stage: 'Waiting to start',
        found: 0,
        addedToUser: 0,
        sourcesDone: [],
        error: null,
      }
    );
  }

  private async run(payload: SearchJobPayload): Promise<void> {
    const { searchId, userId, query, onlySources } = payload;

    await this.setProgress(searchId, {
      status: 'running',
      stage: 'Fetching from job boards',
      found: 0,
      addedToUser: 0,
      sourcesDone: [],
      error: null,
    });

    try {
      const sourcesDone: string[] = [];

      const result = await this.ingestion.search(userId, query, onlySources, {
        recordHistory: false,
        onProgress: (event) => {
          for (const source of event.sourcesDone) {
            if (!sourcesDone.includes(source)) sourcesDone.push(source);
          }

          // Deliberately not awaited. A progress write that fell behind the
          // work would slow the search down to report on it.
          void this.setProgress(searchId, {
            status: 'running',
            stage: event.stage,
            found: 0,
            addedToUser: 0,
            sourcesDone: [...sourcesDone],
            error: null,
          }).catch(() => undefined);
        },
      });

      await this.prisma.jobSearch.update({
        where: { id: searchId },
        data: {
          status: 'COMPLETED',
          totalFound: result.found,
          totalNew: result.addedToUser,
          duplicatesRemoved: result.duplicatesRemoved,
          sourcesSucceeded: result.sourcesSearched,
          sourcesFailed: result.sourcesFailed as unknown as Prisma.InputJsonValue,
          completedAt: new Date(),
          progress: {
            status: 'completed',
            stage: 'Done',
            found: result.found,
            addedToUser: result.addedToUser,
            sourcesDone: result.sourcesSearched,
            error: null,
          } satisfies SearchProgress as unknown as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error.';
      this.logger.warn(`Search ${searchId} failed: ${message}`);

      await this.prisma.jobSearch.update({
        where: { id: searchId },
        data: {
          status: 'FAILED',
          error: message,
          completedAt: new Date(),
          progress: {
            status: 'failed',
            stage: 'Failed',
            found: 0,
            addedToUser: 0,
            sourcesDone: [],
            error: message,
          } satisfies SearchProgress as unknown as Prisma.InputJsonValue,
        },
      });
    }
  }

  private async setProgress(searchId: string, progress: SearchProgress): Promise<void> {
    await this.prisma.jobSearch.update({
      where: { id: searchId },
      data: {
        status: progress.status === 'running' ? 'RUNNING' : undefined,
        progress: progress as unknown as Prisma.InputJsonValue,
      },
    });
  }
}
