import { Injectable } from '@nestjs/common';
import {
  ApplicationStatus,
  SUBMITTED_STATUSES,
  canTransition,
  describeInvalidTransition,
  type ApplicationDto,
  type ApplicationEventDto,
  type CreateApplicationInput,
  type UpdateApplicationInput,
} from '@jobpilot/shared';
import { ApplicationEventType, JobStatus, type Prisma } from '@jobpilot/database';
import { AppException } from '../../common/errors/app-exception';
import { PrismaService } from '../prisma/prisma.service';

const INCLUDE = {
  job: { select: { title: true, companyName: true, jobUrl: true, applicationUrl: true } },
  events: { orderBy: { occurredAt: 'desc' } },
} satisfies Prisma.ApplicationInclude;

type ApplicationRow = Prisma.ApplicationGetPayload<{ include: typeof INCLUDE }>;

/**
 * Tracks applications through their lifecycle.
 *
 * The status graph is enforced, not merely displayed. An application that has
 * been sent cannot go back to DRAFT: the record of having applied is the one
 * thing here the user cannot reconstruct from memory, and a UI bug or a
 * mistyped request should not be able to erase it.
 *
 * Every change writes an event. The history is what makes "when did I hear
 * back?" answerable months later.
 */
@Injectable()
export class ApplicationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string): Promise<ApplicationDto[]> {
    const rows = await this.prisma.application.findMany({
      where: { userId },
      include: INCLUDE,
      orderBy: [{ updatedAt: 'desc' }],
    });

    return rows.map(toDto);
  }

  async get(userId: string, id: string): Promise<ApplicationDto> {
    return toDto(await this.require(userId, id));
  }

  /**
   * Starts tracking an application for a job.
   *
   * One per job: a second application to the same posting is almost always a
   * duplicate click rather than a genuine reapplication, and silently creating
   * it splits the history in two.
   */
  async create(userId: string, input: CreateApplicationInput): Promise<ApplicationDto> {
    const userJob = await this.prisma.userJob.findUnique({
      where: { userId_jobId: { userId, jobId: input.jobId } },
      select: { jobId: true },
    });

    if (!userJob) throw AppException.notFound('NOT_FOUND', 'That job could not be found.');

    const existing = await this.prisma.application.findUnique({
      where: { userId_jobId: { userId, jobId: input.jobId } },
      select: { id: true },
    });

    if (existing) {
      throw AppException.conflict(
        'APPLICATION_ALREADY_EXISTS',
        'You are already tracking an application for this job.',
      );
    }

    if (input.tailoredCvId) await this.requireTailoredCv(userId, input.tailoredCvId);

    const created = await this.prisma.application.create({
      data: {
        userId,
        jobId: input.jobId,
        status: ApplicationStatus.DRAFT,
        method: input.method,
        ...(input.tailoredCvId ? { tailoredCvId: input.tailoredCvId } : {}),
        ...(input.coverLetter ? { coverLetter: input.coverLetter } : {}),
        ...(input.notes ? { notes: input.notes } : {}),
        events: {
          create: { type: ApplicationEventType.CREATED, message: 'Application started.' },
        },
      },
      include: INCLUDE,
    });

    return toDto(created);
  }

  async update(
    userId: string,
    id: string,
    input: UpdateApplicationInput,
  ): Promise<ApplicationDto> {
    const existing = await this.require(userId, id);

    const data: Prisma.ApplicationUpdateInput = {};
    const events: Prisma.ApplicationEventCreateWithoutApplicationInput[] = [];

    if (input.status !== undefined && input.status !== existing.status) {
      if (!canTransition(existing.status, input.status)) {
        throw AppException.badRequest(
          'INVALID_STATE_TRANSITION',
          describeInvalidTransition(existing.status, input.status),
        );
      }

      data.status = input.status;
      events.push({
        type: ApplicationEventType.STATUS_CHANGED,
        message: `${existing.status} → ${input.status}`,
      });

      // Stamped automatically the first time it is marked as sent, so the
      // pipeline metrics have a date without the user having to enter one.
      if (
        SUBMITTED_STATUSES.includes(input.status) &&
        !SUBMITTED_STATUSES.includes(existing.status) &&
        existing.appliedAt === null
      ) {
        data.appliedAt = new Date();
      }
    }

    if (input.appliedAt !== undefined) {
      data.appliedAt = input.appliedAt === null ? null : new Date(input.appliedAt);
    }

    if (input.interviewAt !== undefined) {
      data.interviewDate = input.interviewAt === null ? null : new Date(input.interviewAt);
      if (input.interviewAt !== null) {
        events.push({
          type: ApplicationEventType.INTERVIEW_SCHEDULED,
          message: `Interview set for ${new Date(input.interviewAt).toISOString()}`,
        });
      }
    }

    if (input.notes !== undefined) data.notes = input.notes;

    if (input.tailoredCvId !== undefined) {
      if (input.tailoredCvId === null) {
        data.tailoredCv = { disconnect: true };
      } else {
        await this.requireTailoredCv(userId, input.tailoredCvId);
        data.tailoredCv = { connect: { id: input.tailoredCvId } };
      }
    }

    if (events.length > 0) data.events = { create: events };

    const updated = await this.prisma.application.update({
      where: { id: existing.id },
      data,
      include: INCLUDE,
    });

    // The job's own status follows the application, so the jobs table and the
    // pipeline never disagree about where something stands.
    if (input.status !== undefined) {
      const jobStatus = JOB_STATUS_FOR.get(input.status);
      if (jobStatus) {
        await this.prisma.userJob.updateMany({
          where: { userId, jobId: existing.jobId },
          data: { status: jobStatus },
        });
      }
    }

    return toDto(updated);
  }

  /**
   * Deletes an application.
   *
   * Permitted at any status, including submitted. It is the user's own record
   * and they may have created it by mistake — but the job returns to a plain
   * status so nothing is left claiming an application that no longer exists.
   */
  async remove(userId: string, id: string): Promise<void> {
    const existing = await this.require(userId, id);

    await this.prisma.application.delete({ where: { id: existing.id } });
    await this.prisma.userJob.updateMany({
      where: { userId, jobId: existing.jobId, status: { notIn: [JobStatus.ARCHIVED] } },
      data: { status: JobStatus.SHORTLISTED },
    });
  }

  private async require(userId: string, id: string): Promise<ApplicationRow> {
    const row = await this.prisma.application.findFirst({
      where: { id, userId },
      include: INCLUDE,
    });

    if (!row) throw AppException.notFound('NOT_FOUND', 'That application could not be found.');
    return row;
  }

  private async requireTailoredCv(userId: string, tailoredCvId: string): Promise<void> {
    const cv = await this.prisma.tailoredCV.findFirst({
      where: { id: tailoredCvId, userId },
      select: { id: true },
    });

    if (!cv) {
      throw AppException.badRequest('NOT_FOUND', 'That tailored CV could not be found.');
    }
  }
}

/** Where a job sits once its application reaches a given status. */
const JOB_STATUS_FOR = new Map<ApplicationStatus, JobStatus>([
  [ApplicationStatus.SUBMITTED, JobStatus.APPLIED],
  [ApplicationStatus.ACKNOWLEDGED, JobStatus.APPLIED],
  [ApplicationStatus.INTERVIEW, JobStatus.INTERVIEW],
  [ApplicationStatus.REJECTED, JobStatus.REJECTED],
  [ApplicationStatus.OFFER, JobStatus.OFFER],
]);

function toDto(row: ApplicationRow): ApplicationDto {
  return {
    id: row.id,
    jobId: row.jobId,
    jobTitle: row.job.title,
    companyName: row.job.companyName,
    status: row.status,
    method: row.method,
    applicationUrl: row.job.applicationUrl ?? row.job.jobUrl,
    tailoredCvId: row.tailoredCvId,
    // The letter itself is not sent in the list: it is long, and a row in a
    // table has no use for it.
    hasCoverLetter: Boolean(row.coverLetter?.trim()),
    appliedAt: row.appliedAt?.toISOString() ?? null,
    interviewAt: row.interviewDate?.toISOString() ?? null,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    events: row.events.map(toEvent),
  };
}

function toEvent(event: {
  id: string;
  type: ApplicationEventType;
  message: string | null;
  occurredAt: Date;
}): ApplicationEventDto {
  return {
    id: event.id,
    type: event.type,
    detail: event.message ?? '',
    occurredAt: event.occurredAt.toISOString(),
  };
}
