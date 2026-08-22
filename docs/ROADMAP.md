# Development roadmap

Each phase ends with something you can run and test. Nothing is marked done
until its tests pass against real infrastructure.

---

## Phase 1 — Foundation ✅ Complete

Monorepo, Docker Compose (PostgreSQL + pgvector, Redis), the complete Prisma
schema and first migration, authentication, and the frontend shell.

Delivered: 24 tables migrated and seeded; register / login / refresh with
rotation and reuse detection / logout / change password; profile read and
update with an encrypted phone field; deny-by-default route protection; rate
limiting; structured logging with request ids; audit trail; one error contract;
Next.js shell with sidebar, dark/light mode, responsive layout, login and
register screens, dashboard and settings.

**107 tests pass** (93 API including e2e against real PostgreSQL, 14 web).

---

## Phase 2 — CV ingestion and editing

Upload PDF/DOCX → extract text → structure into `CvDocument` → edit.

- `packages/cv`: `pdf-parse` and `mammoth` extraction behind one interface
- Storage service with local and S3 drivers; type sniffing, size cap, checksum,
  malware-scan hook
- LLM-assisted structuring into the `CvDocument` Zod schema, with the parsed
  vs. user-entered distinction recorded in `parseProvenance`
- Master CV list, default selection, versioning
- Section-by-section editor with autosave
- Email verification and password reset; Google OAuth

Done when: a real PDF CV uploads, parses into editable sections, and survives a
round trip through the editor.

---

## Phase 3 — Job sources

The pluggable adapter layer and the first live sources.

- `packages/job-sources`: the `JobSourceAdapter` interface, registry, and the
  shared policy-enforcing HTTP client (rate limit, backoff, `User-Agent`,
  robots.txt)
- Greenhouse, Lever and Ashby adapters — public, no credentials
- Adzuna and Jooble adapters — official APIs, disabled until keys are present
- Disabled `PARTNER_API` stubs for LinkedIn, Indeed and Glassdoor
- `apps/workers` with BullMQ; the search pipeline with three-tier deduplication
- SSE progress; `SOURCE_NOT_CONFIGURED` surfaced per source

Done when: a keyword search against real Greenhouse boards stores deduplicated,
normalised jobs and streams progress to the browser.

---

## Phase 4 — Jobs dashboard

- TanStack Table: search, filter, sort, paginate, column visibility, bulk select
- Saved views and status filters
- CSV and Excel export
- Job detail drawer with the full description
- Server-side filtering and sorting, cursor pagination for large result sets

---

## Phase 5 — AI matching

- `packages/ai`: provider abstraction (OpenAI, Anthropic, deterministic mock),
  versioned prompt modules, Zod response schemas, retry and token accounting
- `jobAnalysisPrompt` producing the structured score, matching and missing
  skills and experience, and a recommendation
- pgvector embeddings for candidate pre-filtering before the expensive call
- Match % in the table; analysis panel on the job detail

---

## Phase 6 — CV tailoring

- `cvTailoringPrompt` plus the anti-fabrication validator that rejects any
  employer, qualification, date or certification absent from the master CV
- The five templates rendered to DOCX (`docx`) and PDF
- Preview, edit, regenerate, download
- "Why this CV was changed" panel from `changeSummary`
- Bulk generation across selected jobs, processed in the background

---

## Phase 7 — Applications

- Application records and the status pipeline with a full event history
- Apply-manually workflow opening the employer's official page
- Assisted workflow: tailored CV plus cover letter prepared for pasting
- `ApplicationAdapter` interface; automated submission wired only where a
  platform's terms permit it, behind two independent gates
- Latest Jobs view, ranked only on known posting dates

---

## Phase 8 — Contact discovery

- Contacts extracted from permitted sources only, with source, URL, confidence
  and provenance on every field
- Pattern-guessed emails are not implemented and will not be
- `Job` contact snapshot kept in sync
- "No verified public contact found." as a first-class UI state

---

## Phase 9 — Outreach

- `outreachPrompt` drafting from the CV, job, company and recruiter role
- Draft → approve → send lifecycle; sending is impossible without an explicit
  human approval
- Response and follow-up tracking; no bulk send action

---

## Phase 10 — Production readiness

- Dashboard charts and analytics endpoints
- Query optimisation, indexes, Redis caching, cursor pagination everywhere
- Redis-backed throttler storage; scheduled refresh-token pruning
- Playwright end-to-end suite over the critical journeys
- CI, container hardening, backups, monitoring and alerting
