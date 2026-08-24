import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  configFromEnv,
  createDefaultAdapters,
  searchAllSources,
  type JobSourceAdapter,
  type NormalisedJob,
  type NormalisedQuery,
} from '@jobpilot/job-sources';
import type { Prisma } from '@jobpilot/database';
import { ENV, type Env } from '../../config/config.module';
import { PrismaService } from '../prisma/prisma.service';

export interface IngestionResult {
  readonly found: number;
  readonly created: number;
  readonly updated: number;
  readonly addedToUser: number;
  readonly duplicatesRemoved: number;
  readonly sourcesSearched: string[];
  readonly sourcesFailed: { readonly sourceKey: string; readonly reason: string }[];
  readonly sourcesSkipped: { readonly sourceKey: string; readonly reason: string }[];
}

export interface SourceStatusDto {
  readonly key: string;
  readonly name: string;
  readonly kind: string;
  readonly isConfigured: boolean;
  readonly supportsAutomatedApplication: boolean;
  readonly termsUrl: string;
  /** Why it cannot be used, when it cannot. Shown instead of hiding it. */
  readonly unavailableReason: string | null;
}

/**
 * Fetches jobs from the configured sources and stores them.
 *
 * Postings are shared: one `Job` row per posting, with a `UserJob` row per
 * account that has discovered it. Two users searching the same terms get one
 * copy of the posting and independent statuses, notes and scores.
 *
 * Nothing here knows the name of any particular job board. It asks the
 * registry what is configured and writes back whatever comes out, which is
 * what the pluggable-adapter requirement actually buys.
 */
@Injectable()
export class JobIngestionService {
  private readonly logger = new Logger(JobIngestionService.name);
  private readonly adapters: JobSourceAdapter[] = createDefaultAdapters();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** What each source is, and why it is unavailable when it is. */
  sources(): SourceStatusDto[] {
    const config = configFromEnv();

    return this.adapters.map((adapter) => {
      const isConfigured = adapter.isConfigured(config);
      return {
        key: adapter.key,
        name: adapter.displayName,
        kind: adapter.kind,
        isConfigured,
        supportsAutomatedApplication: adapter.capabilities.supportsAutomatedApplication,
        termsUrl: adapter.termsUrl,
        unavailableReason: isConfigured
          ? null
          : `${adapter.displayName} needs credentials that are not set on this deployment.`,
      };
    });
  }

  async search(
    userId: string,
    query: NormalisedQuery,
    onlySources?: readonly string[],
  ): Promise<IngestionResult> {
    const outcome = await searchAllSources(this.adapters, {
      query,
      config: configFromEnv(),
      logger: {
        debug: (message, meta) => this.logger.debug({ meta }, message),
        warn: (message, meta) => this.logger.warn({ meta }, message),
        error: (message, meta) => this.logger.error({ meta }, message),
      },
      ...(onlySources ? { onlySources } : {}),
      // Identifies the crawler and points operators at the project, which is
      // the minimum courtesy for anything that fetches public pages.
      userAgent: this.env.HTTP_USER_AGENT,
      requestsPerMinute: this.env.SOURCE_REQUESTS_PER_MINUTE,
      // Operator-configurable, but it defaults to true and the deployment docs
      // say to leave it that way.
      respectRobotsTxt: this.env.RESPECT_ROBOTS_TXT,
    });

    const sourceIds = await this.ensureSources();

    let created = 0;
    let updated = 0;
    let addedToUser = 0;

    for (const job of outcome.jobs) {
      const sourceId = sourceIds.get(job.sourceKey);
      if (!sourceId) {
        // An adapter returned a key the registry does not list. Skipping is
        // right: writing it would create a posting with no source to attribute
        // it to.
        this.logger.warn(`Ignoring a job from unknown source "${job.sourceKey}".`);
        continue;
      }

      const outcomeForJob = await this.upsertJob(sourceId, job);
      if (outcomeForJob.wasCreated) created += 1;
      else updated += 1;

      if (await this.linkToUser(userId, outcomeForJob.jobId)) addedToUser += 1;
    }

    return {
      found: outcome.jobs.length,
      created,
      updated,
      addedToUser,
      duplicatesRemoved: outcome.dedupe.duplicatesRemoved,
      sourcesSearched: outcome.sourcesSearched,
      sourcesFailed: outcome.sourcesFailed,
      sourcesSkipped: outcome.sourcesSkipped,
    };
  }

  /**
   * Makes sure every adapter has a `job_sources` row, and returns their ids.
   *
   * Done on demand rather than in a migration so that adding an adapter needs
   * no database change — the registry stays the single list of sources.
   */
  private async ensureSources(): Promise<Map<string, string>> {
    const rows = await Promise.all(
      this.adapters.map((adapter) =>
        this.prisma.jobSource.upsert({
          where: { key: adapter.key },
          create: {
            key: adapter.key,
            name: adapter.displayName,
            kind: adapter.kind,
            isEnabled: true,
            supportsAutoApply: adapter.capabilities.supportsAutomatedApplication,
            termsUrl: adapter.termsUrl,
          },
          // Only the facts the adapter owns are refreshed. `isEnabled` and the
          // rate limit are operator settings and are left alone.
          update: {
            name: adapter.displayName,
            kind: adapter.kind,
            supportsAutoApply: adapter.capabilities.supportsAutomatedApplication,
            termsUrl: adapter.termsUrl,
          },
          select: { id: true, key: true },
        }),
      ),
    );

    return new Map(rows.map((row) => [row.key, row.id]));
  }

  private async upsertJob(
    sourceId: string,
    job: NormalisedJob,
  ): Promise<{ jobId: string; wasCreated: boolean }> {
    const existing = await this.prisma.job.findUnique({
      where: { sourceId_externalJobId: { sourceId, externalJobId: job.externalJobId } },
      select: { id: true },
    });

    const data = {
      title: job.title,
      companyName: job.companyName,
      companyWebsite: job.companyWebsite ?? null,
      companyLogo: job.companyLogo ?? null,
      location: job.location ?? null,
      remoteType: job.remoteType,
      employmentType: job.employmentType,
      experienceLevel: job.experienceLevel,
      salaryMin: job.salary?.min ?? null,
      salaryMax: job.salary?.max ?? null,
      currency: job.salary?.currency ?? null,
      salaryPeriod: job.salary?.period ?? 'UNKNOWN',
      // Recorded so the table can label an estimate as an estimate. Without
      // this the column reads as a figure the employer stated, and a range
      // scraped out of prose is not that.
      salaryProvenance: job.salary?.provenance ?? 'NOT_FOUND',
      description: job.description,
      jobUrl: job.jobUrl,
      applicationUrl: job.applicationUrl,
      applyMethod: job.applyMethod,
      // A date is written only when the source published one. `postedAt` is
      // left null otherwise rather than defaulting to now, which would let
      // "posted today" appear next to a posting of unknown age.
      postedAt: job.postedAtKnown ? (job.postedAt ?? null) : null,
      postedAtKnown: job.postedAtKnown,
      contentHash: job.contentHash,
      isActive: true,
    } satisfies Prisma.JobUncheckedUpdateInput;

    if (existing) {
      await this.prisma.job.update({ where: { id: existing.id }, data });
      return { jobId: existing.id, wasCreated: false };
    }

    const row = await this.prisma.job.create({
      data: { ...data, sourceId, externalJobId: job.externalJobId },
      select: { id: true },
    });

    return { jobId: row.id, wasCreated: true };
  }

  /** Returns true when this is the first time the user has seen the posting. */
  private async linkToUser(userId: string, jobId: string): Promise<boolean> {
    const existing = await this.prisma.userJob.findUnique({
      where: { userId_jobId: { userId, jobId } },
      select: { id: true },
    });

    if (existing) return false;

    // A re-run must not reset a job the user has already shortlisted or
    // applied to, which is exactly what a blind upsert would do.
    await this.prisma.userJob.create({ data: { userId, jobId } });
    return true;
  }
}
