import { Injectable, Logger } from '@nestjs/common';
import {
  NO_CONTACT_MESSAGE,
  extractContactsFromJobDescription,
  type DiscoveredContact,
} from '@jobpilot/job-sources';
import { Provenance } from '@jobpilot/shared';
import { Prisma } from '@jobpilot/database';
import { AppException } from '../../common/errors/app-exception';
import { PrismaService } from '../prisma/prisma.service';

export interface ContactDto {
  readonly id: string;
  readonly companyName: string;
  readonly fullName: string;
  readonly title: string | null;
  readonly role: string;
  readonly email: string | null;
  readonly profileUrl: string | null;
  readonly source: string;
  readonly sourceUrl: string | null;
  readonly confidence: number;
  /** Never VERIFIED unless a second permitted source confirmed it. */
  readonly provenance: string;
  readonly emailProvenance: string;
  readonly discoveredAt: string;
}

export interface DiscoverResult {
  readonly found: number;
  readonly contacts: ContactDto[];
  /** Shown verbatim when nothing legitimate was found. */
  readonly message: string | null;
}

/**
 * Finds and stores hiring contacts.
 *
 * The rule this service exists to hold: only contact details an employer has
 * actually published are stored. Addresses are never constructed from a name
 * and a domain — the library refuses to, and there is no flag here to make it.
 * A guessed address is unverified personal data with no lawful basis, and a
 * wrong guess sends a stranger's inbox someone's job application.
 *
 * Where a detail came from is stored beside it, so the UI can show the
 * evidence rather than asking the user to trust a name.
 */
@Injectable()
export class ContactsService {
  private readonly logger = new Logger(ContactsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string): Promise<ContactDto[]> {
    // Scoped to companies the user actually has jobs from. Contacts are
    // company-level rather than user-level, and returning every contact in the
    // database to every account would leak one user's research to another.
    const rows = await this.prisma.contact.findMany({
      where: {
        company: {
          jobs: { some: { userJobs: { some: { userId } } } },
        },
      },
      include: { company: { select: { name: true } } },
      orderBy: [{ confidence: 'desc' }, { discoveredAt: 'desc' }],
      take: 500,
    });

    return rows.map(toDto);
  }

  /**
   * Reads contacts out of a job posting the employer published.
   *
   * The posting itself is the only source used here. It was written to be read
   * by applicants, and anything an employer put in it is published by them for
   * exactly this purpose.
   */
  async discoverForJob(userId: string, jobId: string): Promise<DiscoverResult> {
    const userJob = await this.prisma.userJob.findUnique({
      where: { userId_jobId: { userId, jobId } },
      include: {
        job: {
          select: {
            id: true,
            companyId: true,
            companyName: true,
            companyWebsite: true,
            description: true,
            jobUrl: true,
          },
        },
      },
    });

    if (!userJob) throw AppException.notFound('NOT_FOUND', 'That job could not be found.');

    const result = extractContactsFromJobDescription({
      description: userJob.job.description,
      companyName: userJob.job.companyName,
      jobUrl: userJob.job.jobUrl,
    });

    if (result.contacts.length === 0) {
      return { found: 0, contacts: [], message: result.message ?? NO_CONTACT_MESSAGE };
    }

    const companyId = await this.ensureCompany(
      userJob.job.companyId,
      userJob.job.companyName,
      userJob.job.companyWebsite,
    );

    const stored: ContactDto[] = [];
    for (const contact of result.contacts) {
      const row = await this.upsertContact(companyId, contact);
      if (row) stored.push(row);
    }

    // The highest-confidence contact is denormalised onto the job so the
    // table can show it without a join per row.
    const best = stored[0];
    if (best) {
      await this.prisma.job.update({
        where: { id: userJob.job.id },
        data: {
          primaryContactId: best.id,
          recruiterName: best.fullName,
          recruiterTitle: best.title,
          recruiterEmail: best.email,
          contactSource: best.source,
          contactConfidence: new Prisma.Decimal(best.confidence),
          contactProvenance: best.provenance as Provenance,
        },
      });
    }

    return { found: stored.length, contacts: stored, message: null };
  }

  private async ensureCompany(
    companyId: string | null,
    name: string,
    website: string | null,
  ): Promise<string> {
    if (companyId) return companyId;

    // Matched on the normalised name, which is what the unique index uses.
    // "Stripe", "Stripe, Inc." and "STRIPE" are one employer, and three rows
    // would scatter one company's contacts across three lists.
    const normalizedName = normaliseCompanyName(name);

    const company = await this.prisma.company.upsert({
      where: { normalizedName },
      create: { name, normalizedName, ...(website ? { website } : {}) },
      update: {},
      select: { id: true },
    });

    return company.id;
  }

  /**
   * Stores one contact, keyed on whatever identifies it.
   *
   * A person found twice is one row, not two: the same recruiter appears in
   * every posting their company publishes, and duplicating them would make
   * the list useless within a week.
   */
  private async upsertContact(
    companyId: string,
    contact: DiscoveredContact,
  ): Promise<ContactDto | null> {
    // Nothing is stored without something to identify the person by. A row
    // with neither a name nor an address is not a contact.
    if (!contact.name && !contact.email) return null;

    const where = contact.email
      ? { companyId_email: { companyId, email: contact.email } }
      : contact.profileUrl
        ? { companyId_profileUrl: { companyId, profileUrl: contact.profileUrl } }
        : null;

    const data = {
      companyId,
      fullName: contact.name ?? contact.email ?? 'Unknown',
      title: contact.title,
      role: contact.role,
      email: contact.email,
      profileUrl: contact.profileUrl,
      source: contact.source,
      sourceUrl: contact.sourceUrl,
      confidence: new Prisma.Decimal(contact.confidence),
      provenance: contact.provenance,
      // The address's provenance is tracked separately from the person's. We
      // may be sure who someone is and not at all sure of their email.
      emailProvenance: contact.email ? contact.provenance : Provenance.NOT_FOUND,
      lastSeenAt: new Date(),
    };

    try {
      const row = where
        ? await this.prisma.contact.upsert({
            where,
            create: data,
            update: {
              title: data.title,
              role: data.role,
              confidence: data.confidence,
              lastSeenAt: data.lastSeenAt,
            },
            include: { company: { select: { name: true } } },
          })
        : await this.prisma.contact.create({
            data,
            include: { company: { select: { name: true } } },
          });

      return toDto(row);
    } catch (error) {
      this.logger.warn(
        `Could not store a contact for company ${companyId}: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      return null;
    }
  }
}

/** Company names as written vary; the key they are stored under should not. */
function normaliseCompanyName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(inc|llc|ltd|limited|gmbh|bv|plc|corp|corporation|co|sa|ag|pty)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toDto(row: {
  id: string;
  company: { name: string };
  fullName: string;
  title: string | null;
  role: string;
  email: string | null;
  profileUrl: string | null;
  source: string;
  sourceUrl: string | null;
  confidence: Prisma.Decimal;
  provenance: string;
  emailProvenance: string;
  discoveredAt: Date;
}): ContactDto {
  return {
    id: row.id,
    companyName: row.company.name,
    fullName: row.fullName,
    title: row.title,
    role: row.role,
    email: row.email,
    profileUrl: row.profileUrl,
    source: row.source,
    sourceUrl: row.sourceUrl,
    confidence: Number(row.confidence),
    provenance: row.provenance,
    emailProvenance: row.emailProvenance,
    discoveredAt: row.discoveredAt.toISOString(),
  };
}
