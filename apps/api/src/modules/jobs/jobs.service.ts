import { Injectable } from '@nestjs/common';
import {
  JobStatus,
  buildPageMeta,
  toSkipTake,
  type JobAnalysisDto,
  type JobBulkAction,
  type JobDetailDto,
  type JobListItemDto,
  type JobListQuery,
  type Paginated,
  type Provenance,
  type UpdateJobInput,
} from '@jobpilot/shared';
import type { Prisma } from '@jobpilot/database';
import { AppException } from '../../common/errors/app-exception';
import { CvTailoringService } from '../cv/cv-tailoring.service';
import { PrismaService } from '../prisma/prisma.service';
import { buildJobOrderBy, buildJobWhere } from './jobs.query';

/** How many CVs one bulk action will generate. */
const MAX_BULK_TAILORING = 5;

/** Everything the row DTO needs, in one query rather than N. */
const ROW_INCLUDE = {
  job: {
    include: {
      source: { select: { key: true, name: true } },
    },
  },
} satisfies Prisma.UserJobInclude;

type UserJobRow = Prisma.UserJobGetPayload<{ include: typeof ROW_INCLUDE }>;

@Injectable()
export class JobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tailoring: CvTailoringService,
  ) {}

  /**
   * Lists the user's jobs.
   *
   * Pagination, sorting and filtering all happen in the database. The table
   * is built for tens of thousands of rows, and fetching them to sort in
   * memory would work perfectly in development and fall over in use.
   */
  async list(userId: string, query: JobListQuery): Promise<Paginated<JobListItemDto>> {
    const where = buildJobWhere(userId, query);
    const { skip, take } = toSkipTake(query);

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.userJob.findMany({
        where,
        include: ROW_INCLUDE,
        orderBy: buildJobOrderBy(query.sortBy, query.sortOrder),
        skip,
        take,
      }),
      this.prisma.userJob.count({ where }),
    ]);

    const decorations = await this.decorationsFor(
      userId,
      rows.map((row) => row.jobId),
    );

    return {
      items: rows.map((row) => toListItem(row as UserJobRow, decorations)),
      meta: buildPageMeta(query.page, query.pageSize, total),
    };
  }

  async get(userId: string, jobId: string): Promise<JobDetailDto> {
    const row = await this.prisma.userJob.findUnique({
      where: { userId_jobId: { userId, jobId } },
      include: {
        job: {
          include: {
            source: { select: { key: true, name: true } },
            analyses: {
              where: { userId },
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
          },
        },
      },
    });

    if (!row) throw AppException.notFound('NOT_FOUND', 'That job could not be found.');

    const decorations = await this.decorationsFor(userId, [jobId]);
    const analysis = row.job.analyses[0];

    return {
      ...toListItem(row as unknown as UserJobRow, decorations),
      description: row.job.description,
      analysis: analysis ? toAnalysis(analysis) : null,
    };
  }

  async update(userId: string, jobId: string, input: UpdateJobInput): Promise<JobListItemDto> {
    await this.require(userId, jobId);

    const data: Prisma.UserJobUpdateInput = {};
    if (input.status !== undefined) {
      data.status = input.status;
      // Status and the archive flag are two views of the same fact. Letting
      // them disagree gives a job that reads ARCHIVED but keeps appearing in
      // the default list.
      data.archivedAt = input.status === JobStatus.ARCHIVED ? new Date() : null;
    }
    if (input.isFavourite !== undefined) data.isFavorite = input.isFavourite;
    if (input.notes !== undefined) data.notes = input.notes;

    const row = await this.prisma.userJob.update({
      where: { userId_jobId: { userId, jobId } },
      data,
      include: ROW_INCLUDE,
    });

    const decorations = await this.decorationsFor(userId, [jobId]);
    return toListItem(row as UserJobRow, decorations);
  }

  /**
   * Applies one action to a selection.
   *
   * Scoped by `userId` in the `where` clause rather than checked beforehand,
   * so ids belonging to someone else simply do not match. The count returned
   * is what actually changed, which is why a partly-foreign selection reports
   * fewer updates instead of succeeding silently.
   */
  async bulk(userId: string, action: JobBulkAction): Promise<{ updated: number }> {
    const where: Prisma.UserJobWhereInput = { userId, jobId: { in: action.jobIds } };

    switch (action.action) {
      case 'set-status': {
        const { count } = await this.prisma.userJob.updateMany({
          where,
          data: {
            status: action.status,
            archivedAt: action.status === JobStatus.ARCHIVED ? new Date() : null,
          },
        });
        return { updated: count };
      }

      case 'archive': {
        const { count } = await this.prisma.userJob.updateMany({
          where,
          data: { status: JobStatus.ARCHIVED, archivedAt: new Date() },
        });
        return { updated: count };
      }

      case 'unarchive': {
        const { count } = await this.prisma.userJob.updateMany({
          where,
          // Back to NEW rather than to whatever it was before: the previous
          // status is not recorded, and inventing one would misreport where
          // the user is in their process.
          data: { status: JobStatus.NEW, archivedAt: null },
        });
        return { updated: count };
      }

      case 'favourite':
      case 'unfavourite': {
        const { count } = await this.prisma.userJob.updateMany({
          where,
          data: { isFavorite: action.action === 'favourite' },
        });
        return { updated: count };
      }

      case 'delete': {
        // Removes the user's copy only. The posting itself is shared with
        // every other account that found it.
        const { count } = await this.prisma.userJob.deleteMany({ where });
        return { updated: count };
      }

      case 'generate-cv': {
        // Capped and run in series. Each one is a model call taking seconds,
        // so an uncapped selection of 200 would hold the request open for many
        // minutes and, on a paid provider, spend real money on one click.
        // Proper batching belongs on the job queue; until then the limit is
        // stated rather than silently applied.
        if (action.jobIds.length > MAX_BULK_TAILORING) {
          throw AppException.badRequest(
            'VALIDATION_FAILED',
            `Tailoring runs one CV at a time, so it is limited to ${MAX_BULK_TAILORING} jobs at once. Select fewer and try again.`,
          );
        }

        const owned = await this.prisma.userJob.findMany({
          where,
          select: { jobId: true },
        });

        let generated = 0;
        for (const { jobId } of owned) {
          try {
            await this.tailoring.generate(userId, jobId);
            generated += 1;
          } catch {
            // One job failing must not abandon the rest of the selection.
            // The count returned reflects what actually succeeded.
          }
        }

        return { updated: generated };
      }
    }
  }

  private async require(userId: string, jobId: string): Promise<void> {
    const exists = await this.prisma.userJob.findUnique({
      where: { userId_jobId: { userId, jobId } },
      select: { id: true },
    });
    if (!exists) throw AppException.notFound('NOT_FOUND', 'That job could not be found.');
  }

  /**
   * Looks up which of these jobs have a tailored CV or an application.
   *
   * Two queries for the whole page rather than two per row. At 100 rows the
   * naive version is 200 round trips to a database several hundred
   * milliseconds away.
   */
  private async decorationsFor(userId: string, jobIds: string[]): Promise<Decorations> {
    if (jobIds.length === 0) return { tailoredCvJobIds: new Set(), applicationByJobId: new Map() };

    const [tailored, applications] = await this.prisma.$transaction([
      this.prisma.tailoredCV.findMany({
        where: { userId, jobId: { in: jobIds } },
        select: { jobId: true },
        distinct: ['jobId'],
      }),
      this.prisma.application.findMany({
        where: { userId, jobId: { in: jobIds } },
        select: { id: true, jobId: true },
      }),
    ]);

    return {
      tailoredCvJobIds: new Set(tailored.map((row) => row.jobId)),
      applicationByJobId: new Map(applications.map((row) => [row.jobId, row.id])),
    };
  }
}

interface Decorations {
  readonly tailoredCvJobIds: ReadonlySet<string>;
  readonly applicationByJobId: ReadonlyMap<string, string>;
}

function toListItem(row: UserJobRow, decorations: Decorations): JobListItemDto {
  const job = row.job;

  return {
    id: job.id,
    source: job.source.key,
    sourceDisplayName: job.source.name,
    externalJobId: job.externalJobId,
    title: job.title,
    companyName: job.companyName,
    companyWebsite: job.companyWebsite,
    companyLogo: job.companyLogo,
    location: job.location,
    remoteType: job.remoteType,
    employmentType: job.employmentType,
    experienceLevel: job.experienceLevel,
    salary:
      job.salaryMin === null && job.salaryMax === null
        ? null
        : {
            min: job.salaryMin,
            max: job.salaryMax,
            currency: job.currency,
            period: job.salaryPeriod,
            provenance: job.salaryProvenance,
          },
    jobUrl: job.jobUrl,
    // Falls back to the posting URL. "Apply" must always lead somewhere real,
    // and the posting page is where a human applies when the source published
    // no separate application link.
    applicationUrl: job.applicationUrl ?? job.jobUrl,
    postedAt: job.postedAtKnown ? (job.postedAt?.toISOString() ?? null) : null,
    postedAtKnown: job.postedAtKnown,
    discoveredAt: job.discoveredAt.toISOString(),
    status: row.status,
    relevanceScore: row.relevanceScore,
    isFavourite: row.isFavorite,
    hasTailoredCv: decorations.tailoredCvJobIds.has(job.id),
    applicationId: decorations.applicationByJobId.get(job.id) ?? null,
    contact:
      job.recruiterName || job.recruiterEmail
        ? {
            name: job.recruiterName,
            title: job.recruiterTitle,
            email: job.recruiterEmail,
            source: job.contactSource,
            confidence: job.contactConfidence === null ? null : Number(job.contactConfidence),
            provenance: job.contactProvenance,
          }
        : null,
    notes: row.notes,
  };
}

function toAnalysis(analysis: {
  score: number;
  matchingSkills: string[];
  missingSkills: string[];
  matchingExperience: string[];
  missingExperience: string[];
  recommendation: string;
  reason: string;
  provenance: string;
  promptVersion: string;
  createdAt: Date;
}): JobAnalysisDto {
  return {
    score: analysis.score,
    matchingSkills: analysis.matchingSkills,
    missingSkills: analysis.missingSkills,
    matchingExperience: analysis.matchingExperience,
    missingExperience: analysis.missingExperience,
    recommendation: analysis.recommendation,
    reason: analysis.reason,
    provenance: analysis.provenance as Provenance,
    promptVersion: analysis.promptVersion,
    analysedAt: analysis.createdAt.toISOString(),
  };
}
