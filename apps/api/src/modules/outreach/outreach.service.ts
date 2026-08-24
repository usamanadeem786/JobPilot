import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AiProviderNotConfiguredError, type OutreachDraftingService } from '@jobpilot/ai';
import { CvDocumentSchema } from '@jobpilot/cv';
import {
  canTransitionOutreach,
  decideSend,
  type GenerateOutreachInput,
  type OutreachApproval,
  type OutreachDraftDto,
  type OutreachStatus,
  type UpdateOutreachInput,
} from '@jobpilot/shared';
import type { Prisma } from '@jobpilot/database';
import { AppException } from '../../common/errors/app-exception';
import { OUTREACH_SERVICE } from '../ai/ai.module';
import { ENV, type Env } from '../../config/config.module';
import { PrismaService } from '../prisma/prisma.service';

const INCLUDE = {
  contact: { select: { fullName: true, email: true } },
  job: { select: { title: true, companyName: true } },
} satisfies Prisma.OutreachDraftInclude;

type DraftRow = Prisma.OutreachDraftGetPayload<{ include: typeof INCLUDE }>;

/**
 * Outreach drafts, and the approval gate in front of sending.
 *
 * The brief's instruction was "never send spam automatically". That is
 * implemented as a state machine with no edge from DRAFT to SENT: a message
 * becomes sendable only by passing through APPROVED, approval records who
 * approved what, and the approved text is hashed so an edit afterwards
 * invalidates it.
 *
 * There is no bulk approve and no bulk send. Generating twenty drafts is one
 * action; approving them is twenty. That friction is the point — it is the
 * difference between a tool that helps someone write to twenty people and one
 * that mails twenty strangers on their behalf.
 */
@Injectable()
export class OutreachService {
  private readonly logger = new Logger(OutreachService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(OUTREACH_SERVICE) private readonly drafting: OutreachDraftingService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async list(userId: string): Promise<OutreachDraftDto[]> {
    const rows = await this.prisma.outreachDraft.findMany({
      where: { userId },
      include: INCLUDE,
      orderBy: { createdAt: 'desc' },
    });

    return rows.map(toDto);
  }

  async get(userId: string, id: string): Promise<OutreachDraftDto> {
    return toDto(await this.require(userId, id));
  }

  /** Drafts an introduction to a contact about a specific job. */
  async generate(userId: string, input: GenerateOutreachInput): Promise<OutreachDraftDto> {
    const [contact, userJob, master] = await Promise.all([
      this.prisma.contact.findUnique({
        where: { id: input.contactId },
        select: { id: true, fullName: true, email: true },
      }),
      this.prisma.userJob.findUnique({
        where: { userId_jobId: { userId, jobId: input.jobId } },
        include: { job: { select: { title: true, companyName: true, description: true } } },
      }),
      this.prisma.masterCV.findFirst({
        where: { userId },
        orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
        select: { content: true },
      }),
    ]);

    if (!contact) throw AppException.notFound('NOT_FOUND', 'That contact could not be found.');
    if (!userJob) throw AppException.notFound('NOT_FOUND', 'That job could not be found.');

    if (!master) {
      throw AppException.badRequest(
        'VALIDATION_FAILED',
        'Upload a CV first — an introduction is written from what is in it.',
      );
    }

    const parsedCv = CvDocumentSchema.safeParse(master.content);
    if (!parsedCv.success) {
      throw AppException.unprocessable(
        'VALIDATION_FAILED',
        'Your CV has invalid fields, so no introduction can be written from it yet.',
      );
    }

    try {
      const drafted = await this.drafting.draft({
        cv: parsedCv.data,
        jobTitle: userJob.job.title,
        companyName: userJob.job.companyName,
        jobDescription: userJob.job.description,
        // Never invented. Without a published name the message stays
        // unaddressed rather than guessing at one.
        contactName: contact.fullName || null,
        tone: input.tone,
      });

      const created = await this.prisma.outreachDraft.create({
        data: {
          userId,
          contactId: contact.id,
          jobId: input.jobId,
          channel: input.channel,
          status: 'DRAFT',
          subject: drafted.subject,
          body: drafted.body,
          generationMeta: {
            model: drafted.model,
            promptVersion: drafted.promptVersion,
            generatedAt: drafted.generatedAt,
            claimsMade: drafted.claimsMade,
          } as unknown as Prisma.InputJsonValue,
        },
        include: INCLUDE,
      });

      return toDto(created);
    } catch (error) {
      if (error instanceof AiProviderNotConfiguredError) {
        throw AppException.serviceUnavailable(
          'AI_PROVIDER_NOT_CONFIGURED',
          'No AI provider is configured on this deployment, so introductions cannot be drafted.',
        );
      }
      throw error;
    }
  }

  /**
   * Edits the text.
   *
   * Editing an approved message returns it to DRAFT. The alternative — keeping
   * the approval and letting the text change underneath it — is precisely the
   * hole the body hash exists to close, and closing it in one place rather
   * than two is less to get wrong.
   */
  async update(userId: string, id: string, input: UpdateOutreachInput): Promise<OutreachDraftDto> {
    const existing = await this.require(userId, id);

    if (existing.status === 'SENT' || existing.status === 'RESPONDED') {
      throw AppException.badRequest(
        'INVALID_STATE_TRANSITION',
        'A message that has already been sent cannot be edited.',
      );
    }

    const updated = await this.prisma.outreachDraft.update({
      where: { id: existing.id },
      data: {
        ...(input.subject === undefined ? {} : { subject: input.subject }),
        ...(input.body === undefined ? {} : { body: input.body }),
        ...(existing.status === 'APPROVED' ? { status: 'DRAFT' as const, approvedAt: null } : {}),
      },
      include: INCLUDE,
    });

    return toDto(updated);
  }

  /**
   * Records a person's approval of this exact text.
   *
   * The hash of the approved body is stored alongside, so editing after
   * approval is detectable at send time rather than trusted not to happen.
   */
  async approve(userId: string, id: string): Promise<OutreachDraftDto> {
    const existing = await this.require(userId, id);
    this.requireTransition(existing.status, 'APPROVED');

    const updated = await this.prisma.outreachDraft.update({
      where: { id: existing.id },
      data: {
        status: 'APPROVED',
        approvedAt: new Date(),
        generationMeta: {
          ...(asRecord(existing.generationMeta)),
          approval: {
            approvedByUserId: userId,
            approvedAt: new Date().toISOString(),
            approvedBodyHash: hashBody(existing.body),
          },
        } as unknown as Prisma.InputJsonValue,
      },
      include: INCLUDE,
    });

    return toDto(updated);
  }

  /**
   * Marks a message as sent by the user themselves.
   *
   * Nothing is transmitted from here. No SMTP transport is configured, and
   * even with one the send path runs `decideSend` first — which refuses
   * unless a person approved this exact text. This endpoint records that the
   * user sent it from their own mail client, which is the honest workflow
   * while automated sending is off.
   */
  async markSent(userId: string, id: string): Promise<OutreachDraftDto> {
    const existing = await this.require(userId, id);

    const decision = decideSend({
      status: existing.status,
      approval: readApproval(existing.generationMeta),
      currentBodyHash: hashBody(existing.body),
      recipientEmail: existing.contact.email,
      // Recording a send the user performed does not need our transport. The
      // check exists so that when transport IS configured, the same gate
      // governs both paths.
      transportConfigured: true,
      requireManualApproval: true,
    });

    if (!decision.canSend) {
      throw AppException.badRequest('INVALID_STATE_TRANSITION', decision.reason);
    }

    const updated = await this.prisma.outreachDraft.update({
      where: { id: existing.id },
      data: { status: 'SENT', sentAt: new Date() },
      include: INCLUDE,
    });

    return toDto(updated);
  }

  async setStatus(userId: string, id: string, status: OutreachStatus): Promise<OutreachDraftDto> {
    const existing = await this.require(userId, id);
    this.requireTransition(existing.status, status);

    const updated = await this.prisma.outreachDraft.update({
      where: { id: existing.id },
      data: {
        status,
        ...(status === 'RESPONDED' ? { respondedAt: new Date() } : {}),
      },
      include: INCLUDE,
    });

    return toDto(updated);
  }

  async remove(userId: string, id: string): Promise<void> {
    const existing = await this.require(userId, id);
    await this.prisma.outreachDraft.delete({ where: { id: existing.id } });
  }

  /** Whether this deployment could send email at all. */
  transportConfigured(): boolean {
    return Boolean(this.env.SMTP_HOST && this.env.SMTP_FROM);
  }

  private requireTransition(from: OutreachStatus, to: OutreachStatus): void {
    if (canTransitionOutreach(from, to)) return;

    throw AppException.badRequest(
      'INVALID_STATE_TRANSITION',
      `A message cannot move from ${from} to ${to}.`,
    );
  }

  private async require(userId: string, id: string): Promise<DraftRow> {
    const row = await this.prisma.outreachDraft.findFirst({
      where: { id, userId },
      include: INCLUDE,
    });

    if (!row) throw AppException.notFound('NOT_FOUND', 'That message could not be found.');
    return row;
  }
}

function hashBody(body: string): string {
  return createHash('sha256').update(body.trim()).digest('hex');
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readApproval(meta: unknown): OutreachApproval | null {
  const approval = asRecord(asRecord(meta).approval);

  if (
    typeof approval.approvedByUserId !== 'string' ||
    typeof approval.approvedAt !== 'string' ||
    typeof approval.approvedBodyHash !== 'string'
  ) {
    return null;
  }

  return {
    approvedByUserId: approval.approvedByUserId,
    approvedAt: approval.approvedAt,
    approvedBodyHash: approval.approvedBodyHash,
  };
}

function toDto(row: DraftRow): OutreachDraftDto {
  return {
    id: row.id,
    contactId: row.contactId,
    contactName: row.contact.fullName || null,
    contactEmail: row.contact.email,
    jobId: row.jobId ?? '',
    jobTitle: row.job?.title ?? '(job removed)',
    companyName: row.job?.companyName ?? '',
    channel: row.channel,
    status: row.status,
    subject: row.subject ?? '',
    body: row.body,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    sentAt: row.sentAt?.toISOString() ?? null,
    respondedAt: row.respondedAt?.toISOString() ?? null,
    followUpDueAt: row.followUpAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
