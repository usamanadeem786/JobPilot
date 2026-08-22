/**
 * Seeds reference data that the application needs to boot:
 *  - the job-source registry (which integrations exist and what they permit)
 *  - the built-in CV templates
 *  - baseline system settings
 *
 * Idempotent: safe to re-run on every deploy.
 */
import { JobSourceHealth, JobSourceKind, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface JobSourceSeed {
  key: string;
  name: string;
  kind: JobSourceKind;
  requiresCredentials: boolean;
  supportsAutoApply: boolean;
  requestsPerMinute: number;
  termsUrl: string | null;
  notes: string;
  config?: Record<string, unknown>;
}

/**
 * `isEnabled` is deliberately not seeded as `true` for anything that needs
 * credentials. The API resolves the effective enabled state at runtime by
 * checking whether the adapter reports itself configured.
 */
const JOB_SOURCES: JobSourceSeed[] = [
  {
    key: 'greenhouse',
    name: 'Greenhouse Job Boards',
    kind: JobSourceKind.ATS_BOARD,
    requiresCredentials: false,
    supportsAutoApply: false,
    requestsPerMinute: 30,
    termsUrl: 'https://developers.greenhouse.io/job-board.html',
    notes:
      'Public, documented Job Board API. Read-only. Applications are submitted on the employer’s own Greenhouse-hosted page, so this adapter returns an external application URL.',
    config: { boardTokens: [] },
  },
  {
    key: 'lever',
    name: 'Lever Job Boards',
    kind: JobSourceKind.ATS_BOARD,
    requiresCredentials: false,
    supportsAutoApply: false,
    requestsPerMinute: 30,
    termsUrl: 'https://github.com/lever/postings-api',
    notes:
      'Public postings API published by Lever for company job boards. Read-only; applications happen on the employer’s hosted page.',
    config: { companySlugs: [] },
  },
  {
    key: 'ashby',
    name: 'Ashby Job Boards',
    kind: JobSourceKind.ATS_BOARD,
    requiresCredentials: false,
    supportsAutoApply: false,
    requestsPerMinute: 30,
    termsUrl: 'https://developers.ashbyhq.com/docs/public-job-posting-api',
    notes:
      'Public job-posting API for Ashby-hosted boards. Read-only; applications happen on the employer’s hosted page.',
    config: { jobBoardNames: [] },
  },
  {
    key: 'adzuna',
    name: 'Adzuna',
    kind: JobSourceKind.AGGREGATOR_API,
    requiresCredentials: true,
    supportsAutoApply: false,
    requestsPerMinute: 25,
    termsUrl: 'https://developer.adzuna.com/',
    notes:
      'Official aggregator API with a free developer tier. Requires ADZUNA_APP_ID and ADZUNA_APP_KEY. Redirects the user to the original posting to apply.',
    config: { country: 'gb' },
  },
  {
    key: 'jooble',
    name: 'Jooble',
    kind: JobSourceKind.AGGREGATOR_API,
    requiresCredentials: true,
    supportsAutoApply: false,
    requestsPerMinute: 20,
    termsUrl: 'https://jooble.org/api/about',
    notes:
      'Official aggregator API. Requires JOOBLE_API_KEY. Returns a link to the original posting for manual application.',
  },
  {
    key: 'career-feed',
    name: 'Company Career Feeds',
    kind: JobSourceKind.CAREER_FEED,
    requiresCredentials: false,
    supportsAutoApply: false,
    requestsPerMinute: 10,
    termsUrl: null,
    notes:
      'Reads machine-readable career feeds (RSS/Atom/JSON) that a company publishes for syndication. robots.txt is checked before every fetch and disallowed paths are skipped.',
    config: { feeds: [] },
  },
  {
    key: 'manual-import',
    name: 'Manual Import',
    kind: JobSourceKind.MANUAL_IMPORT,
    requiresCredentials: false,
    supportsAutoApply: false,
    requestsPerMinute: 0,
    termsUrl: null,
    notes:
      'The user pastes a job URL or description found themselves. No automated retrieval from protected platforms.',
  },
  {
    key: 'linkedin',
    name: 'LinkedIn (partner API)',
    kind: JobSourceKind.PARTNER_API,
    requiresCredentials: true,
    supportsAutoApply: false,
    requestsPerMinute: 10,
    termsUrl: 'https://www.linkedin.com/legal/user-agreement',
    notes:
      'DISABLED BY DEFAULT. LinkedIn’s user agreement prohibits scraping. This adapter only activates against LinkedIn’s official Talent/Jobs partner API once a signed agreement and LINKEDIN_PARTNER_API_TOKEN exist. It never touches the consumer web site.',
  },
  {
    key: 'indeed',
    name: 'Indeed (partner API)',
    kind: JobSourceKind.PARTNER_API,
    requiresCredentials: true,
    supportsAutoApply: false,
    requestsPerMinute: 10,
    termsUrl: 'https://www.indeed.com/legal',
    notes:
      'DISABLED BY DEFAULT. Requires an approved Indeed partner integration and INDEED_PARTNER_API_TOKEN. No scraping fallback exists.',
  },
  {
    key: 'glassdoor',
    name: 'Glassdoor (partner API)',
    kind: JobSourceKind.PARTNER_API,
    requiresCredentials: true,
    supportsAutoApply: false,
    requestsPerMinute: 10,
    termsUrl: 'https://www.glassdoor.com/about/terms.htm',
    notes:
      'DISABLED BY DEFAULT. Requires an approved Glassdoor partner integration and GLASSDOOR_PARTNER_API_TOKEN. No scraping fallback exists.',
  },
];

interface CvTemplateSeed {
  key: string;
  name: string;
  description: string;
  engine: string;
  layout: Record<string, unknown>;
}

const CV_TEMPLATES: CvTemplateSeed[] = [
  {
    key: 'modern-ats',
    name: 'Modern ATS',
    description:
      'Single column, no tables or graphics, standard section headings. Optimised for applicant tracking systems that parse plain text.',
    engine: 'docx-single-column',
    layout: {
      font: { body: 'Calibri', heading: 'Calibri', bodySize: 10.5, headingSize: 13 },
      margins: { top: 720, right: 720, bottom: 720, left: 720 },
      accentColor: '#1F2937',
      sectionOrder: [
        'summary',
        'skills',
        'experience',
        'projects',
        'education',
        'certifications',
        'achievements',
      ],
      bulletStyle: 'dash',
    },
  },
  {
    key: 'professional',
    name: 'Professional',
    description: 'Classic serif layout with a subtle rule under each section heading.',
    engine: 'docx-single-column',
    layout: {
      font: { body: 'Georgia', heading: 'Georgia', bodySize: 10.5, headingSize: 14 },
      margins: { top: 900, right: 900, bottom: 900, left: 900 },
      accentColor: '#0F172A',
      sectionOrder: [
        'summary',
        'experience',
        'skills',
        'education',
        'projects',
        'certifications',
        'achievements',
      ],
      sectionRule: true,
    },
  },
  {
    key: 'minimal',
    name: 'Minimal',
    description: 'Generous whitespace, no accent colour, contact details on one line.',
    engine: 'docx-single-column',
    layout: {
      font: { body: 'Helvetica', heading: 'Helvetica', bodySize: 10, headingSize: 12 },
      margins: { top: 1080, right: 1080, bottom: 1080, left: 1080 },
      accentColor: '#000000',
      sectionOrder: ['summary', 'experience', 'projects', 'skills', 'education'],
      compact: true,
    },
  },
  {
    key: 'software-engineer',
    name: 'Software Engineer',
    description:
      'Leads with a technical skills matrix and project highlights, tuned for engineering roles.',
    engine: 'docx-single-column',
    layout: {
      font: { body: 'Inter', heading: 'Inter', bodySize: 10, headingSize: 13 },
      margins: { top: 720, right: 720, bottom: 720, left: 720 },
      accentColor: '#2563EB',
      sectionOrder: [
        'summary',
        'skills',
        'experience',
        'projects',
        'certifications',
        'education',
        'achievements',
      ],
      skillsLayout: 'grouped',
    },
  },
  {
    key: 'executive',
    name: 'Executive',
    description: 'Emphasises scope, leadership and measurable outcomes over tooling detail.',
    engine: 'docx-single-column',
    layout: {
      font: { body: 'Garamond', heading: 'Garamond', bodySize: 11, headingSize: 15 },
      margins: { top: 900, right: 900, bottom: 900, left: 900 },
      accentColor: '#111827',
      sectionOrder: [
        'summary',
        'achievements',
        'experience',
        'education',
        'certifications',
        'skills',
      ],
      showAchievementsFirst: true,
    },
  },
];

const SYSTEM_SETTINGS: { key: string; value: unknown; description: string }[] = [
  {
    key: 'compliance.respectRobotsTxt',
    value: true,
    description:
      'When true, every outbound source request checks the target robots.txt first. Turning this off is not supported.',
  },
  {
    key: 'compliance.allowAutomatedApplications',
    value: false,
    description:
      'Global kill switch. Automated submission is additionally gated per source by JobSource.supportsAutoApply.',
  },
  {
    key: 'outreach.requireManualApproval',
    value: true,
    description: 'Outreach messages can never be sent without an explicit user approval action.',
  },
  {
    key: 'search.maxJobsPerSourcePerRun',
    value: 100,
    description: 'Upper bound on results pulled from a single source in one search run.',
  },
];

async function main(): Promise<void> {
  for (const source of JOB_SOURCES) {
    await prisma.jobSource.upsert({
      where: { key: source.key },
      create: {
        key: source.key,
        name: source.name,
        kind: source.kind,
        requiresCredentials: source.requiresCredentials,
        supportsAutoApply: source.supportsAutoApply,
        requestsPerMinute: source.requestsPerMinute,
        termsUrl: source.termsUrl,
        notes: source.notes,
        config: (source.config ?? {}) as never,
        isEnabled: !source.requiresCredentials,
        health: source.requiresCredentials
          ? JobSourceHealth.NOT_CONFIGURED
          : JobSourceHealth.UNKNOWN,
      },
      // Never overwrite operator-managed columns (isEnabled, config, health).
      update: {
        name: source.name,
        kind: source.kind,
        requiresCredentials: source.requiresCredentials,
        supportsAutoApply: source.supportsAutoApply,
        termsUrl: source.termsUrl,
        notes: source.notes,
      },
    });
  }

  for (const template of CV_TEMPLATES) {
    await prisma.cVTemplate.upsert({
      where: { key: template.key },
      create: {
        key: template.key,
        name: template.name,
        description: template.description,
        engine: template.engine,
        layout: template.layout as never,
        isSystem: true,
      },
      update: {
        name: template.name,
        description: template.description,
        engine: template.engine,
        layout: template.layout as never,
      },
    });
  }

  for (const setting of SYSTEM_SETTINGS) {
    await prisma.systemSetting.upsert({
      where: { key: setting.key },
      create: {
        key: setting.key,
        value: setting.value as never,
        description: setting.description,
      },
      update: { description: setting.description },
    });
  }

  const counts = {
    jobSources: await prisma.jobSource.count(),
    cvTemplates: await prisma.cVTemplate.count(),
    systemSettings: await prisma.systemSetting.count(),
  };
  // eslint-disable-next-line no-console
  console.log('Seed complete:', counts);
}

main()
  .catch((error: unknown) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
