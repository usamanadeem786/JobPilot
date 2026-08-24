import { Inject, Injectable, Logger } from '@nestjs/common';
import { CvDocumentSchema } from '@jobpilot/cv';
import type { JobMatchingService } from '@jobpilot/ai';
import { Provenance, type JobAnalysisDto } from '@jobpilot/shared';
import { AppException } from '../../common/errors/app-exception';
import { JOB_MATCHING_SERVICE } from '../ai/ai.module';
import { PrismaService } from '../prisma/prisma.service';

export interface AnalyseResult {
  readonly analysed: number;
  readonly skipped: number;
  /** Present when the LLM was configured but a call fell back mid-run. */
  readonly degradedReason: string | null;
}

/** How many jobs one "analyse all" run will process. */
const MAX_BATCH = 25;

/**
 * Scores jobs against the user's default CV.
 *
 * Every score is an estimate, and the record says which kind: a language
 * model's reading or a keyword count. That distinction is stored, not just
 * displayed, so a heuristic score is never later mistaken for an AI one when
 * the numbers are aggregated.
 *
 * Nothing here writes to the CV or the posting. Analysis is an opinion about
 * the pair, kept beside them.
 */
@Injectable()
export class JobAnalysisService {
  private readonly logger = new Logger(JobAnalysisService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(JOB_MATCHING_SERVICE) private readonly matching: JobMatchingService,
  ) {}

  /** Analyses one job, replacing any previous analysis for the same CV. */
  async analyseOne(userId: string, jobId: string): Promise<JobAnalysisDto> {
    const { cv, document } = await this.requireDefaultCv(userId);

    const userJob = await this.prisma.userJob.findUnique({
      where: { userId_jobId: { userId, jobId } },
      include: { job: true },
    });

    if (!userJob) throw AppException.notFound('NOT_FOUND', 'That job could not be found.');

    const analysis = await this.matching.analyse({
      cv: document,
      jobTitle: userJob.job.title,
      companyName: userJob.job.companyName,
      jobDescription: userJob.job.description,
      ...(userJob.job.location ? { jobLocation: userJob.job.location } : {}),
      remoteType: userJob.job.remoteType,
      experienceLevel: userJob.job.experienceLevel,
    });

    const stored = await this.prisma.jobAnalysis.upsert({
      where: { userId_jobId_masterCvId: { userId, jobId, masterCvId: cv.id } },
      create: {
        userId,
        jobId,
        masterCvId: cv.id,
        score: analysis.score,
        recommendation: analysis.recommendation,
        matchingSkills: analysis.matchingSkills,
        missingSkills: analysis.missingSkills,
        matchingExperience: analysis.matchingExperience,
        missingExperience: analysis.missingExperience,
        reason: analysis.reason,
        provider: analysis.method,
        model: analysis.model ?? analysis.method,
        promptVersion: analysis.promptVersion ?? 'heuristic',
        // Always an inference, whichever path produced it. Recording it
        // explicitly is what lets the UI badge the number rather than present
        // it as a measurement.
        provenance: Provenance.AI_INFERENCE,
      },
      update: {
        score: analysis.score,
        recommendation: analysis.recommendation,
        matchingSkills: analysis.matchingSkills,
        missingSkills: analysis.missingSkills,
        matchingExperience: analysis.matchingExperience,
        missingExperience: analysis.missingExperience,
        reason: analysis.reason,
        provider: analysis.method,
        model: analysis.model ?? analysis.method,
        promptVersion: analysis.promptVersion ?? 'heuristic',
      },
    });

    // Denormalised onto the join so the table can sort by relevance without
    // joining the analyses on every query.
    await this.prisma.userJob.update({
      where: { userId_jobId: { userId, jobId } },
      data: { relevanceScore: analysis.score },
    });

    if (analysis.fellBackBecause) {
      this.logger.warn(
        `Analysis for job ${jobId} fell back to the heuristic: ${analysis.fellBackBecause}`,
      );
    }

    return toDto(stored);
  }

  /**
   * Analyses the user's unscored jobs, newest first.
   *
   * Capped per run. An unbounded loop over a few thousand jobs would hold a
   * request open for many minutes and, with a paid provider, spend real money
   * on one click.
   */
  async analyseUnscored(userId: string, limit = MAX_BATCH): Promise<AnalyseResult> {
    const { cv, document } = await this.requireDefaultCv(userId);

    const pending = await this.prisma.userJob.findMany({
      where: { userId, relevanceScore: null, archivedAt: null },
      include: { job: true },
      orderBy: { job: { discoveredAt: 'desc' } },
      take: Math.min(limit, MAX_BATCH),
    });

    let analysed = 0;
    let degradedReason: string | null = null;

    for (const userJob of pending) {
      try {
        const analysis = await this.matching.analyse({
          cv: document,
          jobTitle: userJob.job.title,
          companyName: userJob.job.companyName,
          jobDescription: userJob.job.description,
          ...(userJob.job.location ? { jobLocation: userJob.job.location } : {}),
          remoteType: userJob.job.remoteType,
          experienceLevel: userJob.job.experienceLevel,
        });

        await this.prisma.$transaction([
          this.prisma.jobAnalysis.upsert({
            where: {
              userId_jobId_masterCvId: { userId, jobId: userJob.jobId, masterCvId: cv.id },
            },
            create: {
              userId,
              jobId: userJob.jobId,
              masterCvId: cv.id,
              score: analysis.score,
              recommendation: analysis.recommendation,
              matchingSkills: analysis.matchingSkills,
              missingSkills: analysis.missingSkills,
              matchingExperience: analysis.matchingExperience,
              missingExperience: analysis.missingExperience,
              reason: analysis.reason,
              provider: analysis.method,
              model: analysis.model ?? analysis.method,
              promptVersion: analysis.promptVersion ?? 'heuristic',
              provenance: Provenance.AI_INFERENCE,
            },
            update: {
              score: analysis.score,
              recommendation: analysis.recommendation,
              reason: analysis.reason,
              provider: analysis.method,
            },
          }),
          this.prisma.userJob.update({
            where: { userId_jobId: { userId, jobId: userJob.jobId } },
            data: { relevanceScore: analysis.score },
          }),
        ]);

        analysed += 1;
        degradedReason ??= analysis.fellBackBecause;
      } catch (error) {
        // One bad posting must not abandon the rest of the batch. The job
        // simply stays unscored and is picked up next time.
        this.logger.warn(
          `Could not analyse job ${userJob.jobId}: ${error instanceof Error ? error.message : 'unknown error'}`,
        );
      }
    }

    return { analysed, skipped: pending.length - analysed, degradedReason };
  }

  /**
   * The CV every score is measured against.
   *
   * Analysis is meaningless without one, and silently scoring against an empty
   * document would produce confident zeroes for a well-qualified applicant.
   */
  private async requireDefaultCv(
    userId: string,
  ): Promise<{ cv: { id: string }; document: ReturnType<typeof CvDocumentSchema.parse> }> {
    const cv = await this.prisma.masterCV.findFirst({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
      select: { id: true, content: true },
    });

    if (!cv) {
      throw AppException.badRequest(
        'VALIDATION_FAILED',
        'Upload a CV first — a match score is measured against it.',
      );
    }

    const parsed = CvDocumentSchema.safeParse(cv.content);
    if (!parsed.success) {
      throw AppException.unprocessable(
        'VALIDATION_FAILED',
        'Your CV has invalid fields, so it cannot be matched against jobs yet. Open it and correct them.',
      );
    }

    return { cv: { id: cv.id }, document: parsed.data };
  }
}

function toDto(row: {
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
    score: row.score,
    matchingSkills: row.matchingSkills,
    missingSkills: row.missingSkills,
    matchingExperience: row.matchingExperience,
    missingExperience: row.missingExperience,
    recommendation: row.recommendation,
    reason: row.reason,
    provenance: row.provenance as JobAnalysisDto['provenance'],
    promptVersion: row.promptVersion,
    analysedAt: row.createdAt.toISOString(),
  };
}
