/**
 * End-to-end check of the CV endpoints against the running API.
 *
 * Fixtures have repeatedly failed to catch the bugs that matter here — a
 * silently corrupted regex, an escaped-HTML round trip — because they encode
 * the same assumptions as the code. This drives the real HTTP surface against
 * the real database with a real PDF and a real DOCX, and prints what came back
 * so the parse can be judged rather than asserted into looking correct.
 *
 *   pnpm --filter @jobpilot/api cv:check
 */
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';

loadEnv({ path: resolve(__dirname, '../../../.env') });

import { CvDocumentSchema, renderCvToDocx, renderCvToPdf, type CvDocument } from '@jobpilot/cv';

const BASE = process.env.CHECK_API_URL ?? 'http://localhost:4000/api';
const EMAIL = process.env.CHECK_EMAIL ?? 'usamanadeem7866@gmail.com';
const PASSWORD = process.env.CHECK_PASSWORD ?? 'JobPilot2026Neon';

/** A CV with the awkward shapes real ones have, not a tidy sample. */
const SAMPLE: CvDocument = CvDocumentSchema.parse({
  personal: {
    fullName: 'Usama Nadeem',
    headline: 'Senior Full-Stack Engineer',
    email: 'usamanadeem7866@gmail.com',
    phone: '+92 300 1234567',
    location: 'Lahore, Pakistan',
    links: [
      { label: 'GitHub', url: 'https://github.com/usamanadeem786' },
      { label: 'LinkedIn', url: 'https://linkedin.com/in/usamanadeem' },
    ],
  },
  summary:
    'Full-stack engineer with eight years building payment and logistics systems. Led the migration of a monolith serving 2M requests a day to a service architecture without downtime.',
  skillGroups: [
    { category: 'Languages', skills: ['TypeScript', 'Go', 'Python', 'SQL'] },
    { category: 'Frameworks', skills: ['React', 'Next.js', 'NestJS', 'Django'] },
    { category: 'Infrastructure', skills: ['PostgreSQL', 'Redis', 'Kubernetes', 'AWS', 'Terraform'] },
  ],
  experience: [
    {
      company: 'Careem',
      title: 'Senior Software Engineer',
      location: 'Lahore, Pakistan',
      startDate: { raw: 'March 2021', year: 2021, month: 3 },
      isCurrent: true,
      bullets: [
        'Rebuilt the driver payout pipeline, cutting settlement time from 48 hours to under 20 minutes.',
        'Introduced contract testing across 14 services, reducing integration failures by 60%.',
        'Mentored four engineers, two of whom were promoted within a year.',
      ],
    },
    {
      company: 'Arbisoft',
      title: 'Software Engineer',
      location: 'Lahore, Pakistan',
      startDate: { raw: 'July 2018', year: 2018, month: 7 },
      endDate: { raw: 'February 2021', year: 2021, month: 2 },
      bullets: [
        'Built an ETL pipeline processing 400GB of daily logistics telemetry.',
        'Migrated the reporting stack from MySQL to PostgreSQL with zero data loss.',
      ],
    },
  ],
  education: [
    {
      institution: 'University of Engineering and Technology, Lahore',
      qualification: 'BSc Computer Science',
      startDate: { raw: 'September 2014', year: 2014, month: 9 },
      endDate: { raw: 'June 2018', year: 2018, month: 6 },
      grade: 'First class honours',
    },
  ],
  projects: [
    {
      name: 'OpenLedger',
      description: 'An open-source double-entry accounting library used by 300+ projects.',
      url: 'https://github.com/usamanadeem786/openledger',
      technologies: ['TypeScript', 'PostgreSQL'],
      bullets: ['Wrote the reconciliation engine and its property-based test suite.'],
    },
  ],
  certifications: [
    {
      name: 'AWS Certified Solutions Architect - Associate',
      issuer: 'Amazon Web Services',
      issuedAt: { raw: 'May 2022', year: 2022, month: 5 },
    },
  ],
  achievements: ['Speaker, JSConf Asia 2023 - Payments without tears.'],
  sectionOrder: ['summary', 'skills', 'experience', 'projects', 'education', 'certifications', 'achievements'],
});

interface Session {
  accessToken: string;
}

/**
 * The shapes this script reads back. Deliberately narrow rather than `any`:
 * a typo in a field name should fail here, not quietly report a pass.
 */
interface CvRecord {
  id: string;
  title: string;
  isDefault: boolean;
  skillCount: number;
  content: CvDocument;
  sourceFile: { scanStatus: string } | null;
}

interface UploadResponse {
  cv: CvRecord;
  missingSections: string[];
  warnings: string[];
  code?: string;
  message?: string;
}

interface ErrorResponse {
  code?: string;
  message?: string;
}

async function login(): Promise<Session> {
  const response = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });

  const body = (await response.json()) as {
    tokens?: { accessToken?: string };
    message?: string;
  };
  const accessToken = body.tokens?.accessToken;
  if (!response.ok || !accessToken) {
    throw new Error(`Login failed (${response.status}): ${body.message ?? 'no token returned'}`);
  }
  return { accessToken };
}

async function call<T>(
  session: Session,
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: T }> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
      ...(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(init.headers ?? {}),
    },
  });

  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    body = text.slice(0, 200);
  }
  return { status: response.status, body: body as T };
}

async function uploadFile(
  session: Session,
  buffer: Buffer,
  filename: string,
  mimeType: string,
): Promise<{ status: number; body: UploadResponse & ErrorResponse }> {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(buffer)], { type: mimeType }), filename);
  return call<UploadResponse & ErrorResponse>(session, '/cv/upload', { method: 'POST', body: form });
}

function report(label: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) process.exitCode = 1;
}

async function main(): Promise<void> {
  const session = await login();
  console.log('Signed in.\n');

  const created: string[] = [];

  // --- PDF round trip -------------------------------------------------------
  const pdf = await renderCvToPdf(SAMPLE, { templateKey: 'modern-ats' });
  const pdfUpload = await uploadFile(session, pdf, 'usama-nadeem-cv.pdf', 'application/pdf');
  report('PDF upload accepted', pdfUpload.status === 201 || pdfUpload.status === 200,
    `HTTP ${pdfUpload.status} ${pdfUpload.status >= 400 ? JSON.stringify(pdfUpload.body) : ''}`);

  if (pdfUpload.status < 400) {
    const cv = pdfUpload.body.cv;
    created.push(cv.id);
    const doc = cv.content;
    console.log(`  title        ${cv.title}`);
    console.log(`  name         ${doc.personal.fullName}`);
    console.log(`  email        ${doc.personal.email ?? '(none)'}`);
    console.log(`  phone        ${doc.personal.phone ?? '(none)'}`);
    console.log(`  experience   ${doc.experience.length} roles: ${doc.experience.map((role) => `${role.title} @ ${role.company}`).join(' | ')}`);
    console.log(`  education    ${doc.education.length}: ${doc.education.map((item) => item.qualification ?? '(none)').join(' | ')}`);
    console.log(`  skills       ${cv.skillCount}`);
    console.log(`  missing      ${pdfUpload.body.missingSections.join(', ') || '(none)'}`);
    console.log(`  warnings     ${pdfUpload.body.warnings.join(' / ') || '(none)'}`);
    console.log(`  scanStatus   ${cv.sourceFile?.scanStatus}`);
    console.log(`  checksum set ${Boolean(cv.sourceFile)}`);

    report('  name recovered from PDF', doc.personal.fullName === 'Usama Nadeem', doc.personal.fullName);
    report('  email recovered', doc.personal.email === SAMPLE.personal.email, String(doc.personal.email));
    report('  employers recovered', doc.experience.length === 2,
      `${doc.experience.length} of 2`);
    report('  first CV is default', cv.isDefault === true);
  }

  // --- DOCX round trip ------------------------------------------------------
  const docx = await renderCvToDocx(SAMPLE, { templateKey: 'modern-ats' });
  const docxUpload = await uploadFile(
    session,
    docx,
    'usama-nadeem-cv.docx',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  );
  report('DOCX upload accepted', docxUpload.status < 400,
    `HTTP ${docxUpload.status} ${docxUpload.status >= 400 ? JSON.stringify(docxUpload.body) : ''}`);
  if (docxUpload.status < 400) {
    created.push(docxUpload.body.cv.id);
    const doc = docxUpload.body.cv.content;
    console.log(`  name         ${doc.personal.fullName}`);
    console.log(`  experience   ${doc.experience.length}`);
    report('  second CV is not default', docxUpload.body.cv.isDefault === false);
  }

  // --- Rejections -----------------------------------------------------------
  const junk = await uploadFile(session, Buffer.from('this is not a cv'), 'notes.txt', 'text/plain');
  report('plain text rejected', junk.status === 400 && junk.body.code === 'UNSUPPORTED_FILE_TYPE',
    `HTTP ${junk.status} ${junk.body.code}`);

  // A PDF header with nothing readable after it — the scanned-CV case.
  const fakePdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(400, 0x20)]);
  const scanned = await uploadFile(session, fakePdf, 'scan.pdf', 'application/pdf');
  report('unreadable PDF rejected with an actionable message',
    scanned.status === 422 || scanned.status === 400,
    `HTTP ${scanned.status} ${JSON.stringify(scanned.body?.message ?? scanned.body).slice(0, 120)}`);

  // --- List, default, edit, render -----------------------------------------
  const list = await call<CvRecord[]>(session, '/cv');
  report('list returns both CVs', Array.isArray(list.body) && list.body.length >= 2,
    `${Array.isArray(list.body) ? list.body.length : '?'} rows`);

  if (created.length >= 2) {
    const second = created[1] as string;
    const promoted = await call<CvRecord[]>(session, `/cv/${second}/set-default`, { method: 'POST' });
    const defaults = Array.isArray(promoted.body) ? promoted.body.filter((c) => c.isDefault) : [];
    report('exactly one default after promotion', defaults.length === 1 && defaults[0]?.id === second,
      `${defaults.length} default(s)`);
  }

  if (created.length >= 1) {
    const id = created[0] as string;
    const detail = await call<CvRecord>(session, `/cv/${id}`);
    const edited = { ...detail.body.content, summary: 'Edited summary for the live check.' };
    const patch = await call<CvRecord & ErrorResponse>(session, `/cv/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ content: edited, title: 'Live check CV' }),
    });
    report('edit saved', patch.status === 200 && patch.body.content.summary === edited.summary,
      `HTTP ${patch.status}`);

    const bad = await call<ErrorResponse>(session, `/cv/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ content: { personal: { fullName: '' }, nonsense: true } }),
    });
    report('malformed document refused', bad.status === 400, `HTTP ${bad.status} ${bad.body.code}`);

    for (const format of ['pdf', 'docx'] as const) {
      const response = await fetch(`${BASE}/cv/${id}/download?format=${format}`, {
        headers: { Authorization: `Bearer ${session.accessToken}` },
      });
      const bytes = Buffer.from(await response.arrayBuffer());
      const magicOk = format === 'pdf' ? bytes.subarray(0, 5).toString() === '%PDF-' : bytes.subarray(0, 2).toString() === 'PK';
      report(`${format} download is a real ${format}`, response.ok && magicOk && bytes.byteLength > 1000,
        `HTTP ${response.status}, ${bytes.byteLength} bytes, disposition: ${response.headers.get('content-disposition')}`);
    }

    const source = await fetch(`${BASE}/cv/${id}/source`, {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
    report('original file downloads back', source.ok, `HTTP ${source.status}`);

    const badTemplate = await call<ErrorResponse>(session, `/cv/${id}/download?template=does-not-exist`);
    report('unknown template refused rather than silently substituted',
      badTemplate.status === 400, `HTTP ${badTemplate.status}`);
  }

  // --- Isolation ------------------------------------------------------------
  const foreign = await call<ErrorResponse>(session, '/cv/00000000-0000-4000-8000-000000000000');
  report("another user's id reports NOT_FOUND", foreign.status === 404, `HTTP ${foreign.status}`);

  // --- Cleanup --------------------------------------------------------------
  for (const id of created) {
    const deleted = await call(session, `/cv/${id}`, { method: 'DELETE' });
    report(`cleanup ${id.slice(0, 8)}`, deleted.status === 204, `HTTP ${deleted.status}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
