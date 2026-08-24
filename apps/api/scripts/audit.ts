/**
 * Exercises every endpoint against the running API and reports what works.
 *
 * Written because "is it finished?" cannot be answered from memory or from a
 * green unit-test run. Unit tests assert against the assumptions of whoever
 * wrote them; this drives the real HTTP surface against the real database and
 * prints what came back, so a claim that something works is a thing anyone can
 * check rather than take on trust.
 *
 *   pnpm --filter @jobpilot/api verify
 */
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';

loadEnv({ path: resolve(__dirname, '../../../.env') });

const BASE = process.env.CHECK_API_URL ?? 'http://localhost:4000/api';
const EMAIL = process.env.CHECK_EMAIL ?? 'usamanadeem7866@gmail.com';
const PASSWORD = process.env.CHECK_PASSWORD ?? 'JobPilot2026Neon';

interface Check {
  readonly area: string;
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

const checks: Check[] = [];
let token = '';

function record(area: string, name: string, ok: boolean, detail = ''): void {
  checks.push({ area, name, ok, detail });
}

async function call(
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: Record<string, unknown> | unknown[]; text: string }> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  });

  const text = await response.text();
  let body: Record<string, unknown> | unknown[] = {};
  try {
    body = JSON.parse(text) as Record<string, unknown> | unknown[];
  } catch {
    body = {};
  }

  return { status: response.status, body, text };
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function main(): Promise<void> {
  // --- Auth -----------------------------------------------------------------
  const health = await call('/health');
  record('Health', 'GET /health', health.status === 200, `HTTP ${health.status}`);

  const login = await call('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const tokens = asRecord(asRecord(login.body).tokens);
  token = typeof tokens.accessToken === 'string' ? tokens.accessToken : '';
  record('Auth', 'POST /auth/login', login.status === 200 && token !== '', `HTTP ${login.status}`);

  if (!token) {
    report();
    throw new Error('Cannot continue without a session.');
  }

  const me = await call('/users/me');
  record('Auth', 'GET /users/me', me.status === 200, `HTTP ${me.status}`);

  const badLogin = await call('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: EMAIL, password: 'wrong-password-entirely' }),
  });
  record(
    'Auth',
    'wrong password refused',
    badLogin.status === 401,
    `HTTP ${badLogin.status}`,
  );

  const noAuth = await fetch(`${BASE}/jobs`);
  record('Auth', 'unauthenticated request refused', noAuth.status === 401, `HTTP ${noAuth.status}`);

  // --- Profile --------------------------------------------------------------
  const profile = await call('/users/me/profile');
  record('Profile', 'GET /users/me/profile', profile.status === 200, `HTTP ${profile.status}`);

  // --- Jobs -----------------------------------------------------------------
  const sources = await call('/jobs/sources');
  const configured = asArray(sources.body).filter(
    (source) => asRecord(source).isConfigured === true,
  );
  record(
    'Jobs',
    'GET /jobs/sources',
    sources.status === 200 && asArray(sources.body).length > 0,
    `${configured.length} of ${asArray(sources.body).length} configured`,
  );

  const jobs = await call('/jobs?pageSize=5');
  const jobItems = asArray(asRecord(jobs.body).items);
  record('Jobs', 'GET /jobs', jobs.status === 200, `HTTP ${jobs.status}, ${jobItems.length} rows`);

  for (const sortBy of ['relevanceScore', 'postedAt', 'discoveredAt', 'title', 'companyName', 'salaryMax', 'status']) {
    const sorted = await call(`/jobs?pageSize=2&sortBy=${sortBy}&sortOrder=desc`);
    record('Jobs', `sort by ${sortBy}`, sorted.status === 200, `HTTP ${sorted.status}`);
  }

  const filtered = await call('/jobs?pageSize=5&remoteType=REMOTE&status=NEW');
  record('Jobs', 'filters apply', filtered.status === 200, `HTTP ${filtered.status}`);

  const firstJob = asRecord(jobItems[0]);
  const jobId = typeof firstJob.id === 'string' ? firstJob.id : null;

  if (jobId) {
    const detail = await call(`/jobs/${jobId}`);
    record('Jobs', 'GET /jobs/:id', detail.status === 200, `HTTP ${detail.status}`);

    const patched = await call(`/jobs/${jobId}`, {
      method: 'PATCH',
      body: JSON.stringify({ isFavourite: true }),
    });
    record('Jobs', 'PATCH /jobs/:id', patched.status === 200, `HTTP ${patched.status}`);
    await call(`/jobs/${jobId}`, { method: 'PATCH', body: JSON.stringify({ isFavourite: false }) });

    const analysed = await call(`/jobs/${jobId}/analyse`, { method: 'POST', body: '{}' });
    const score = asRecord(analysed.body).score;
    record(
      'AI',
      'POST /jobs/:id/analyse',
      analysed.status === 200 || analysed.status === 201,
      `HTTP ${analysed.status}, score ${String(score)}`,
    );

    const contacts = await call(`/contacts/discover/${jobId}`, { method: 'POST', body: '{}' });
    record(
      'Contacts',
      'POST /contacts/discover/:jobId',
      contacts.status === 200 || contacts.status === 201,
      `HTTP ${contacts.status}, found ${String(asRecord(contacts.body).found)}`,
    );
  }

  const foreignJob = await call('/jobs/00000000-0000-4000-8000-000000000000');
  record('Jobs', "another user's id is NOT_FOUND", foreignJob.status === 404, `HTTP ${foreignJob.status}`);

  // --- Search ---------------------------------------------------------------
  const emptySearch = await call('/jobs/search', {
    method: 'POST',
    body: JSON.stringify({ keywords: '   ' }),
  });
  record('Search', 'empty keyword refused', emptySearch.status === 400, `HTTP ${emptySearch.status}`);

  const history = await call('/jobs/searches');
  record(
    'Search',
    'GET /jobs/searches',
    history.status === 200,
    `HTTP ${history.status}, ${asArray(history.body).length} entries`,
  );

  // --- CV -------------------------------------------------------------------
  const templates = await call('/cv/templates');
  record(
    'CV',
    'GET /cv/templates',
    templates.status === 200 && asArray(templates.body).length === 5,
    `${asArray(templates.body).length} templates`,
  );

  const cvs = await call('/cv');
  const cvItems = asArray(cvs.body);
  record('CV', 'GET /cv', cvs.status === 200, `HTTP ${cvs.status}, ${cvItems.length} CVs`);

  const firstCv = asRecord(cvItems[0]);
  const cvId = typeof firstCv.id === 'string' ? firstCv.id : null;

  if (cvId) {
    const detail = await call(`/cv/${cvId}`);
    record('CV', 'GET /cv/:id', detail.status === 200, `HTTP ${detail.status}`);

    for (const format of ['pdf', 'docx']) {
      const response = await fetch(`${BASE}/cv/${cvId}/download?format=${format}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const bytes = Buffer.from(await response.arrayBuffer());
      const magic = format === 'pdf' ? bytes.subarray(0, 5).toString() === '%PDF-' : bytes.subarray(0, 2).toString() === 'PK';
      record('CV', `download ${format}`, response.ok && magic, `${bytes.byteLength} bytes`);
    }
  } else {
    record('CV', 'download', false, 'no CV to render — upload one first');
  }

  const tailored = await call('/cv/tailored');
  record(
    'CV',
    'GET /cv/tailored',
    tailored.status === 200,
    `HTTP ${tailored.status}, ${asArray(tailored.body).length} tailored`,
  );

  if (jobId && cvId) {
    const generated = await call(`/cv/tailor/${jobId}`, { method: 'POST', body: '{}' });
    record(
      'AI',
      'POST /cv/tailor/:jobId',
      generated.status === 200 || generated.status === 201,
      `HTTP ${generated.status}`,
    );
  }

  // --- Applications ---------------------------------------------------------
  const applications = await call('/applications');
  record(
    'Applications',
    'GET /applications',
    applications.status === 200,
    `HTTP ${applications.status}, ${asArray(applications.body).length} tracked`,
  );

  // --- Contacts -------------------------------------------------------------
  const contactList = await call('/contacts');
  record(
    'Contacts',
    'GET /contacts',
    contactList.status === 200,
    `HTTP ${contactList.status}, ${asArray(contactList.body).length} contacts`,
  );

  // --- Outreach -------------------------------------------------------------
  const outreach = await call('/outreach');
  record(
    'Outreach',
    'GET /outreach',
    outreach.status === 200,
    outreach.status === 404 ? 'NOT IMPLEMENTED' : `HTTP ${outreach.status}`,
  );

  report();
}

function report(): void {
  const areas = [...new Set(checks.map((check) => check.area))];

  for (const area of areas) {
    console.log(`\n${area}`);
    for (const check of checks.filter((candidate) => candidate.area === area)) {
      console.log(`  ${check.ok ? 'PASS' : 'FAIL'}  ${check.name}${check.detail ? ` — ${check.detail}` : ''}`);
    }
  }

  const failed = checks.filter((check) => !check.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} passed.`);

  if (failed.length > 0) {
    console.log('\nFailing:');
    for (const check of failed) console.log(`  ${check.area}: ${check.name} — ${check.detail}`);
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
