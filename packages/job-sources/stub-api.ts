/**
 * A stand-in API that serves REAL jobs, fetched once from the live Greenhouse
 * and Lever boards and held in memory.
 *
 * Its purpose is to exercise the jobs dashboard against genuine data —
 * real titles, real locations, real missing fields — before the database and
 * persistence layer exist. Fixtures would not surface the things real board
 * data does, such as absent salaries and untrimmed locations.
 *
 * Development only. It has no authentication and no persistence.
 *
 *   pnpm --filter @jobpilot/job-sources exec tsx stub-api.ts
 */
import { createServer } from 'node:http';
import { analyseHeuristically, type JobAnalysis } from '@jobpilot/ai';
import { CvDocumentSchema, type CvDocument } from '@jobpilot/cv';
import { createDefaultAdapters, searchAllSources, type NormalisedJob } from './src/index';

/** A stand-in master CV, so scores are computed against something real. */
const SAMPLE_CV: CvDocument = CvDocumentSchema.parse({
  personal: {
    fullName: 'Usama Nadeem',
    headline: 'Senior Python Backend Developer',
    location: 'Lahore, Pakistan',
  },
  summary: 'Backend engineer building Django and FastAPI services on PostgreSQL.',
  skillGroups: [
    { category: 'Languages', skills: ['Python', 'TypeScript', 'SQL'] },
    { category: 'Frameworks', skills: ['Django', 'FastAPI', 'Celery'] },
    { category: 'Data', skills: ['PostgreSQL', 'Redis'] },
    { category: 'Platform', skills: ['Docker', 'AWS'] },
  ],
  experience: [
    {
      company: 'Acme Systems',
      title: 'Senior Backend Engineer',
      isCurrent: true,
      bullets: ['Migrated a Django monolith to FastAPI services', 'Built REST APIs on PostgreSQL'],
    },
  ],
});

const PORT = 4000;

interface StoredJob extends NormalisedJob {
  id: string;
  status: string;
  isFavourite: boolean;
  relevanceScore: number | null;
  discoveredAt: string;
  analysis: JobAnalysis;
}

let jobs: StoredJob[] = [];

function toDto(job: StoredJob): unknown {
  return {
    id: job.id,
    source: job.sourceKey,
    sourceDisplayName: job.sourceKey === 'greenhouse' ? 'Greenhouse' : 'Lever',
    externalJobId: job.externalJobId,
    title: job.title,
    companyName: job.companyName,
    companyWebsite: null,
    companyLogo: null,
    location: job.location ?? null,
    remoteType: job.remoteType,
    employmentType: job.employmentType,
    experienceLevel: job.experienceLevel,
    salary: job.salary
      ? {
          min: job.salary.min ?? null,
          max: job.salary.max ?? null,
          currency: job.salary.currency ?? null,
          period: job.salary.period,
        }
      : null,
    jobUrl: job.jobUrl,
    applicationUrl: job.applicationUrl,
    postedAt: job.postedAt?.toISOString() ?? null,
    postedAtKnown: job.postedAtKnown,
    discoveredAt: job.discoveredAt,
    status: job.status,
    relevanceScore: job.relevanceScore,
    isFavourite: job.isFavourite,
    hasTailoredCv: false,
    applicationId: null,
    contact: null,
    notes: null,
  };
}

async function load(): Promise<void> {
  console.log('Fetching real jobs from Greenhouse and Lever...');

  const outcome = await searchAllSources(createDefaultAdapters(), {
    query: { keywords: 'engineer', limit: 120 },
    config: { GREENHOUSE_BOARD_TOKENS: 'stripe,figma,gitlab', LEVER_COMPANY_SLUGS: 'netflix' },
    logger: { debug: () => {}, warn: () => {}, error: () => {} },
    userAgent: 'JobPilot/0.1 (+https://github.com/usamanadeem786/JobPilot)',
    requestsPerMinute: 60,
  });

  jobs = outcome.jobs.map((job, index) => ({
    ...job,
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    status: ['NEW', 'SHORTLISTED', 'APPLIED', 'INTERVIEW', 'REJECTED'][index % 5] ?? 'NEW',
    isFavourite: index % 7 === 0,
    relevanceScore: null,
    discoveredAt: new Date().toISOString(),
    analysis: {} as JobAnalysis,
  }));

  // Real heuristic analysis against the sample CV — the actual Phase 5 code
  // path, run over real job descriptions.
  for (const job of jobs) {
    const analysis = analyseHeuristically({
      cv: SAMPLE_CV,
      jobTitle: job.title,
      jobDescription: job.description,
      ...(job.location ? { jobLocation: job.location } : {}),
      remoteType: job.remoteType,
      experienceLevel: job.experienceLevel,
    });

    job.analysis = {
      ...analysis,
      method: 'heuristic',
      promptVersion: null,
      model: null,
      fellBackBecause: null,
      analysedAt: new Date().toISOString(),
    };
    job.relevanceScore = analysis.score;
  }

  console.log(`Loaded ${jobs.length} real jobs (${outcome.dedupe.duplicatesRemoved} duplicates removed).`);
}

function applyQuery(url: URL): { items: unknown[]; total: number; page: number; pageSize: number } {
  const page = Number(url.searchParams.get('page') ?? '1');
  const pageSize = Number(url.searchParams.get('pageSize') ?? '25');
  const search = url.searchParams.get('search')?.toLowerCase();
  const status = url.searchParams.get('status')?.split(',');
  const remoteType = url.searchParams.get('remoteType')?.split(',');
  const sortBy = url.searchParams.get('sortBy') ?? 'discoveredAt';
  const sortOrder = url.searchParams.get('sortOrder') ?? 'desc';

  let filtered = [...jobs];

  if (search) {
    filtered = filtered.filter((job) =>
      `${job.title} ${job.companyName} ${job.description}`.toLowerCase().includes(search),
    );
  }
  if (status?.length) filtered = filtered.filter((job) => status.includes(job.status));
  if (remoteType?.length) filtered = filtered.filter((job) => remoteType.includes(job.remoteType));

  const direction = sortOrder === 'asc' ? 1 : -1;
  filtered.sort((left, right) => {
    const pick = (job: StoredJob): string | number => {
      switch (sortBy) {
        case 'title':
          return job.title.toLowerCase();
        case 'companyName':
          return job.companyName.toLowerCase();
        case 'relevanceScore':
          return job.relevanceScore ?? -1;
        case 'postedAt':
          return job.postedAt?.getTime() ?? 0;
        case 'status':
          return job.status;
        default:
          return job.discoveredAt;
      }
    };
    const a = pick(left);
    const b = pick(right);
    return a === b ? 0 : (a < b ? -1 : 1) * direction;
  });

  const start = (page - 1) * pageSize;
  return {
    items: filtered.slice(start, start + pageSize).map(toDto),
    total: filtered.length,
    page,
    pageSize,
  };
}

async function main(): Promise<void> {
  await load();

  createServer((request, response) => {
    const url = new URL(request.url ?? '/', `http://localhost:${PORT}`);
    const send = (status: number, body: unknown): void => {
      response.writeHead(status, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(body));
    };

    if (url.pathname === '/api/jobs' && request.method === 'GET') {
      const result = applyQuery(url);
      send(200, {
        items: result.items,
        meta: {
          page: result.page,
          pageSize: result.pageSize,
          total: result.total,
          totalPages: Math.ceil(result.total / result.pageSize),
          hasNextPage: result.page * result.pageSize < result.total,
          hasPreviousPage: result.page > 1,
        },
      });
      return;
    }

    if (url.pathname.startsWith('/api/jobs/') && request.method === 'GET') {
      const id = url.pathname.split('/').pop();
      const job = jobs.find((entry) => entry.id === id);
      if (!job) {
        send(404, { statusCode: 404, code: 'NOT_FOUND', message: 'No such job.', timestamp: '' });
        return;
      }
      send(200, {
        ...(toDto(job) as Record<string, unknown>),
        description: job.description,
        analysis: {
          score: job.analysis.score,
          matchingSkills: job.analysis.matchingSkills,
          missingSkills: job.analysis.missingSkills,
          matchingExperience: job.analysis.matchingExperience,
          missingExperience: job.analysis.missingExperience,
          recommendation: job.analysis.recommendation,
          reason: job.analysis.reason,
          method: job.analysis.method,
          provenance: 'AI_INFERENCE',
          promptVersion: job.analysis.promptVersion ?? 'heuristic-1',
          analysedAt: job.analysis.analysedAt,
        },
      });
      return;
    }

    if (url.pathname.startsWith('/api/jobs/') && request.method === 'PATCH') {
      const id = url.pathname.split('/').pop();
      const job = jobs.find((entry) => entry.id === id);
      let body = '';
      request.on('data', (chunk) => (body += chunk));
      request.on('end', () => {
        if (job) {
          const patch = JSON.parse(body || '{}') as { isFavourite?: boolean; status?: string };
          if (patch.isFavourite !== undefined) job.isFavourite = patch.isFavourite;
          if (patch.status) job.status = patch.status;
        }
        send(200, job ? toDto(job) : {});
      });
      return;
    }

    if (url.pathname === '/api/jobs/bulk' && request.method === 'POST') {
      let body = '';
      request.on('data', (chunk) => (body += chunk));
      request.on('end', () => {
        const payload = JSON.parse(body || '{}') as { jobIds?: string[]; status?: string };
        let updated = 0;
        for (const job of jobs) {
          if (payload.jobIds?.includes(job.id)) {
            if (payload.status) job.status = payload.status;
            updated += 1;
          }
        }
        send(200, { updated });
      });
      return;
    }

    // Auth endpoints the app shell calls on load.
    if (url.pathname === '/api/auth/refresh') {
      send(200, {
        user: {
          id: 'stub',
          email: 'you@example.com',
          role: 'USER',
          status: 'ACTIVE',
          emailVerified: true,
          fullName: 'Usama Nadeem',
          createdAt: new Date().toISOString(),
        },
        tokens: { accessToken: 'stub', expiresIn: 900, tokenType: 'Bearer' },
      });
      return;
    }

    if (url.pathname === '/api/users/me/profile') {
      send(200, {
        id: 'stub',
        fullName: 'Usama Nadeem',
        headline: null,
        phone: null,
        locationCity: null,
        locationCountry: null,
        timezone: null,
        yearsExperience: null,
        desiredRoles: [],
        desiredLocations: [],
        remotePreference: 'UNKNOWN',
        minSalary: null,
        salaryCurrency: null,
        skills: [],
        linkedinUrl: null,
        githubUrl: null,
        portfolioUrl: null,
        updatedAt: new Date().toISOString(),
      });
      return;
    }

    send(404, { statusCode: 404, code: 'NOT_FOUND', message: 'Not found', timestamp: '' });
  }).listen(PORT, () => console.log(`Stub API on http://localhost:${PORT}`));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
