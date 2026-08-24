/**
 * Exercises the outreach approval gate end to end.
 *
 * The gate is the safety-critical part of this feature — the brief's "never
 * send spam automatically" is enforced by it — so it is checked against the
 * real HTTP surface rather than only in unit tests. Real job postings almost
 * never publish a contact, so this seeds one, drives the state machine, and
 * removes everything it created.
 *
 *   pnpm --filter @jobpilot/api outreach:check
 */
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';

loadEnv({ path: resolve(__dirname, '../../../.env') });

import { PrismaClient } from '@jobpilot/database';

const BASE = process.env.CHECK_API_URL ?? 'http://localhost:4000/api';
const EMAIL = process.env.CHECK_EMAIL ?? 'usamanadeem7866@gmail.com';
const PASSWORD = process.env.CHECK_PASSWORD ?? 'JobPilot2026Neon';

let token = '';
let failures = 0;

function report(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

async function call(
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });

  const text = await response.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    body = {};
  }

  return { status: response.status, body };
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();

  const login = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const session = (await login.json()) as { tokens?: { accessToken?: string } };
  token = session.tokens?.accessToken ?? '';
  if (!token) throw new Error('Could not sign in.');

  const user = await prisma.user.findUnique({ where: { email: EMAIL }, select: { id: true } });
  if (!user) throw new Error('No such user.');

  const userJob = await prisma.userJob.findFirst({
    where: { userId: user.id },
    include: { job: { select: { id: true, companyId: true, companyName: true } } },
  });
  if (!userJob) throw new Error('No jobs to work with. Run a search first.');

  // A company and a contact to write to. Removed at the end.
  const company = await prisma.company.upsert({
    where: { normalizedName: 'outreach check company' },
    create: { name: 'Outreach Check Company', normalizedName: 'outreach check company' },
    update: {},
    select: { id: true },
  });

  const contact = await prisma.contact.create({
    data: {
      companyId: company.id,
      fullName: 'Alex Recruiter',
      title: 'Talent Partner',
      role: 'RECRUITER',
      email: 'careers@outreach-check.example',
      source: 'outreach-check:seed',
      confidence: 0.9,
      provenance: 'KNOWN',
      emailProvenance: 'KNOWN',
    },
    select: { id: true },
  });

  let draftId = '';

  try {
    // --- Draft --------------------------------------------------------------
    const created = await call('/outreach', {
      method: 'POST',
      body: JSON.stringify({ contactId: contact.id, jobId: userJob.job.id }),
    });
    draftId = typeof created.body.id === 'string' ? created.body.id : '';
    report(
      'draft generated',
      created.status === 201 && draftId !== '',
      `HTTP ${created.status}, status ${String(created.body.status)}`,
    );

    if (!draftId) return;

    // --- Sending before approval must be refused ----------------------------
    const early = await call(`/outreach/${draftId}/sent`, { method: 'POST', body: '{}' });
    report(
      'cannot mark sent before approval',
      early.status === 400,
      `HTTP ${early.status}: ${String(early.body.message)}`,
    );

    // --- Approve ------------------------------------------------------------
    const approved = await call(`/outreach/${draftId}/approve`, { method: 'POST', body: '{}' });
    report(
      'approval recorded',
      approved.status === 201 && approved.body.status === 'APPROVED',
      `HTTP ${approved.status}, approvedAt ${String(approved.body.approvedAt)}`,
    );

    // --- Editing after approval must revoke it ------------------------------
    const edited = await call(`/outreach/${draftId}`, {
      method: 'PATCH',
      body: JSON.stringify({ body: 'Completely different text that nobody has reviewed.' }),
    });
    report(
      'editing after approval returns it to draft',
      edited.status === 200 && edited.body.status === 'DRAFT',
      `status is now ${String(edited.body.status)}`,
    );

    const afterEdit = await call(`/outreach/${draftId}/sent`, { method: 'POST', body: '{}' });
    report(
      'edited message cannot be sent on the old approval',
      afterEdit.status === 400,
      `HTTP ${afterEdit.status}: ${String(afterEdit.body.message)}`,
    );

    // --- Approve the new text, then record the send -------------------------
    await call(`/outreach/${draftId}/approve`, { method: 'POST', body: '{}' });
    const sent = await call(`/outreach/${draftId}/sent`, { method: 'POST', body: '{}' });
    report(
      'approved message can be recorded as sent',
      sent.status === 201 && sent.body.status === 'SENT',
      `HTTP ${sent.status}, sentAt ${String(sent.body.sentAt)}`,
    );

    // --- A sent message is immutable ----------------------------------------
    const editSent = await call(`/outreach/${draftId}`, {
      method: 'PATCH',
      body: JSON.stringify({ body: 'Changing history.' }),
    });
    report(
      'a sent message cannot be edited',
      editSent.status === 400,
      `HTTP ${editSent.status}`,
    );

    // --- Illegal transition -------------------------------------------------
    const illegal = await call(`/outreach/${draftId}/status`, {
      method: 'POST',
      body: JSON.stringify({ status: 'DRAFT' }),
    });
    report(
      'SENT cannot go back to DRAFT',
      illegal.status === 400,
      `HTTP ${illegal.status}: ${String(illegal.body.message)}`,
    );
  } finally {
    if (draftId) await call(`/outreach/${draftId}`, { method: 'DELETE' });
    await prisma.outreachDraft.deleteMany({ where: { contactId: contact.id } });
    await prisma.contact.delete({ where: { id: contact.id } }).catch(() => undefined);
    await prisma.company.delete({ where: { id: company.id } }).catch(() => undefined);
    await prisma.$disconnect();
    console.log('\nSeeded contact and company removed.');
  }

  if (failures > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
