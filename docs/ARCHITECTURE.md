# Architecture

## 1. Shape of the system

```
                    ┌──────────────────────────────┐
  Browser ────────► │  apps/web — Next.js 15        │
                    │  App Router, React 19, RQ     │
                    └───────────────┬──────────────┘
                                    │ REST + SSE, cookie-based refresh
                    ┌───────────────▼──────────────┐
                    │  apps/api — NestJS 11         │
                    │  auth · jobs · cv · contacts  │
                    └───┬─────────┬─────────┬──────┘
                        │         │         │
              ┌─────────▼──┐  ┌───▼────┐  ┌─▼──────────────┐
              │ PostgreSQL │  │ Redis  │  │ LLM provider   │
              │ + pgvector │  │ BullMQ │  │ (OpenAI/…)     │
              └────────────┘  └───┬────┘  └────────────────┘
                                  │ same code, no HTTP server
                    ┌─────────────▼────────────────┐
                    │  apps/workers — BullMQ        │
                    │  search · analyse · generate  │
                    └───────────────┬──────────────┘
                                    │ via packages/job-sources
                    ┌───────────────▼──────────────┐
                    │  Greenhouse · Lever · Ashby   │
                    │  Adzuna · Jooble · feeds      │
                    └──────────────────────────────┘
```

Three deployable processes (`web`, `api`, `workers`) share five libraries. The
worker is a separate process, not a thread in the API, because a 200-job search
that calls an LLM per job would otherwise compete with request handling for the
event loop — a slow search would make login slow.

---

## 2. Technology decisions

### NestJS over Express

Express is a router; everything above it is a convention you invent and then
enforce by code review. This application needs the things Nest gives you as
first-class primitives:

- **Dependency injection.** The job-source registry resolves an array of
  adapters through a DI token. Adding a source is one provider registration —
  no service knows the list. Same for LLM providers.
- **Guards, interceptors and filters as declarative cross-cutting concerns.**
  Authentication, roles, rate limiting and error shaping are applied globally
  once, in `AppModule`. A new controller is protected by default; you opt *out*
  with `@Public()`. With Express, protection is opt-in — and the failure mode
  of forgetting is an open endpoint.
- **Module boundaries.** Fourteen feature areas stay separable, with explicit
  imports and exports rather than a folder convention.
- **Testability.** `Test.createTestingModule` boots the real graph with
  targeted overrides, which is why the e2e suite exercises the actual guards
  and middleware instead of a stubbed app.
- **First-class integrations** for the pieces already in the plan: BullMQ
  (`@nestjs/bullmq`), SSE (`@Sse()`), scheduling, config, throttling.

The cost is decorators, DI wiring and a heavier startup. For a long-lived
multi-module product that cost is repaid quickly; for a five-endpoint service it
would not be.

### Other choices

| Choice | Why | Alternative rejected |
| --- | --- | --- |
| **pnpm + Turborepo** | Strict `node_modules` catches undeclared dependencies; Turbo caches per-package builds. | npm workspaces — no strictness, no task graph. Nx — more machinery than five packages need. |
| **Prisma** | Typed client generated from one schema, honest migrations, parameterised queries everywhere. `Unsupported()` still allows raw pgvector queries. | TypeORM (weaker types), Drizzle (excellent, but Prisma's migration workflow suits a schema this wide). |
| **PostgreSQL + pgvector** | One datastore for relational data, full-text search and embeddings. A separate vector database is a second system to operate for tens of thousands of rows. | Pinecone/Qdrant — revisit past ~1M vectors. |
| **Zod in a shared package** | The browser and the server validate with the *same object*. Divergence is impossible, not merely discouraged. | `class-validator` on the API and a second schema on the web — two definitions of truth. |
| **Argon2id via `@node-rs/argon2`** | OWASP's recommendation, with prebuilt binaries (no node-gyp on Windows). | bcrypt — a 72-byte input limit and weaker GPU resistance. |
| **Rotating refresh tokens in an httpOnly cookie** | XSS cannot read the long-lived credential; rotation makes theft detectable. | JWT in localStorage — one XSS is a permanent account takeover. |
| **TanStack Query** | Server state has different rules from UI state: caching, retries, invalidation. | Redux — hand-rolling all of that. |
| **Tailwind v4 + hand-written shadcn-style components** | Tokens defined once in `globals.css`; components are owned source, not a dependency to fight. | A component library — restyling it costs more than owning ~200 lines. |

---

## 3. Repository layout

```
/apps
  /api        NestJS REST API, SSE, auth              (Phase 1 ✓)
  /web        Next.js App Router frontend             (Phase 1 ✓)
  /workers    BullMQ processors                       (Phase 3)
/packages
  /config     tsconfig + ESLint bases                 (Phase 1 ✓)
  /shared     Zod schemas, DTOs, enums, error codes   (Phase 1 ✓)
  /database   Prisma schema, client, migrations, seed (Phase 1 ✓)
  /ai         LLM abstraction, prompts, validators    (Phase 5)
  /job-sources Adapter interface + implementations    (Phase 3)
  /cv         Parsing, tailoring, DOCX/PDF rendering  (Phase 2/6)
/docs         Architecture, compliance, API, security
```

Why these boundaries: `job-sources`, `ai` and `cv` are each imported by both the
API and the workers. Making them packages rather than API folders is what keeps
the worker from importing a controller. `shared` is the only package the web app
depends on, and it deliberately contains no Node-only code (no `crypto`, no
`fs`), so it bundles for the browser.

Enum duplication between Prisma and `shared` is deliberate — the web app must
not pull in `@prisma/client`. `apps/api/src/common/enum-parity.test.ts` fails
the build if the two drift.

---

## 4. Layering inside the API

```
Controller   HTTP only: route, validate with a Zod pipe, shape the response.
    │        Never contains business rules.
Service      Business rules. Throws AppException with an ErrorCode.
    │        Knows nothing about HTTP status codes.
Repository   Prisma access. (Currently PrismaService injected directly;
    │        extracted per-aggregate when query complexity justifies it.)
Database
```

Cross-cutting concerns are global providers, applied in this order:
`ThrottlerGuard` → `JwtAuthGuard` → `RolesGuard`, with `AllExceptionsFilter`
normalising every thrown value into one `ApiErrorBody`.

---

## 5. Job-source adapter architecture (Phase 3)

Every source implements one interface. Nothing outside the package knows which
sources exist.

```ts
export interface JobSourceAdapter {
  readonly key: string;                    // 'greenhouse'
  readonly kind: JobSourceKind;            // ATS_BOARD | AGGREGATOR_API | …
  readonly capabilities: SourceCapabilities;

  /** False when credentials are absent; the API then reports
   *  SOURCE_NOT_CONFIGURED instead of failing mid-search. */
  isConfigured(): boolean;

  searchJobs(query: NormalisedQuery, ctx: SourceContext): Promise<RawJob[]>;
  getJobDetails(externalId: string, ctx: SourceContext): Promise<RawJob | null>;
  normalizeJob(raw: RawJob): NormalisedJob;
  getApplicationUrl(job: NormalisedJob): ApplicationTarget;
  healthCheck(): Promise<SourceHealth>;
}

export interface SourceCapabilities {
  readonly supportsRemoteFilter: boolean;
  readonly supportsSalaryFilter: boolean;
  readonly providesPostingDate: boolean;   // drives Job.postedAtKnown
  readonly providesFullDescription: boolean;
  readonly supportsAutomatedApplication: boolean;  // false for every launch source
}
```

`SourceContext` carries the shared, policy-enforcing HTTP client — rate limit,
backoff, `User-Agent`, robots.txt. An adapter that bypasses it does not get
merged.

**Search pipeline** (a BullMQ job, streamed to the client over SSE):

```
resolve enabled + configured sources
  └─ fan out, one child job per source, bounded concurrency
       └─ searchJobs → normalizeJob → contentHash
  └─ deduplicate:  (sourceId, externalJobId)   exact re-fetch
                   contentHash                 same posting, two sources
                   trigram title+company       near-duplicate, flagged
  └─ upsert canonical Job + per-user UserJob
  └─ enqueue relevance analysis
  └─ mark search complete
```

A source that fails does not fail the search: it is recorded in
`JobSearch.sourcesFailed` and reported per-source in the UI.

---

## 6. AI architecture (Phase 5)

```
packages/ai
  /providers      OpenAiProvider · AnthropicProvider · MockProvider
  /prompts        jobAnalysis · cvTailoring · coverLetter · outreach
  /schemas        Zod schema per prompt — the response contract
  /validators     Anti-fabrication checks
  llm.service.ts  Retry, timeout, token accounting, structured output
```

One interface, provider chosen by `LLM_PROVIDER`:

```ts
export interface LlmProvider {
  readonly name: string;
  isConfigured(): boolean;
  complete<T>(request: StructuredRequest<T>): Promise<StructuredResponse<T>>;
  embed?(input: string[]): Promise<number[][]>;
}
```

Three rules make this safe to rely on:

1. **Prompts are versioned modules, never inline strings.** Each exports a
   template, a `promptVersion`, and its response Zod schema. The version is
   stored on every result, so output produced by an older prompt is
   identifiable.
2. **Every response is parsed before it is saved.** A malformed response is
   retried, then surfaced as `AI_RESPONSE_INVALID` — never written to the
   database half-parsed.
3. **Tailoring output is diffed against the master CV.** A validator rejects any
   employer, qualification, date or certification not present in the source
   document. Fabrication fails the generation; it does not reach the user.

`MockProvider` returns deterministic fixtures, so AI-dependent code is unit
testable without a key or a network call.

---

## 7. CV pipeline (Phases 2 and 6)

```
Upload (PDF/DOCX)
  → validate: extension, MIME sniff, size, malware-scan hook
  → store: FileObject (local disk or S3), SHA-256 checksum
  → extract text
  → LLM structures it into CvDocument (Zod-validated)
  → MasterCV { rawText, content, parseProvenance }

Tailor(masterCv, job, template)
  → jobAnalysis  → JobAnalysis  (score, matching/missing)
  → cvTailoring  → CvDocument + changeSummary
  → anti-fabrication validator
  → TailoredCV { content, changeSummary, status: DRAFT }
  → render → DOCX (docx) / PDF → FileObject
```

`CvDocument` is one Zod schema used by the master CV, every tailored version,
the editor and both renderers. `changeSummary` is what the *"Why this CV was
changed"* panel reads: keywords emphasised, experience emphasised, skills
matched, and requirements the CV does not evidence.

Master and tailored CVs are separate entities. Tailoring never mutates the
master, and each job's version is independently editable.

---

## 8. Data model notes

The full schema is `packages/database/prisma/schema.prisma`. Two decisions are
worth stating because they differ from the brief:

**`Job` is global; `UserJob` is per-user.** The brief lists `status` and
`relevanceScore` on the job. In a multi-user system those are per-user facts —
two users looking at the same posting have different statuses. So the canonical
posting is stored once and deduplicated across every user and search, while
`UserJob` holds status, relevance, notes and archive state. The API flattens
the two, so the client still receives a single job object with `status` and
`relevanceScore` exactly as specified.

**Contact data is denormalised onto `Job` on purpose.** `Job.recruiterName`,
`recruiterEmail`, `contactSource`, `contactConfidence` mirror the
highest-confidence `Contact`. The jobs table renders those columns for hundreds
of rows; a join per row would not hold up. The contact-discovery service owns
keeping the snapshot in sync.

---

## 9. Background jobs (Phase 3)

| Queue | Work | Concurrency |
| --- | --- | --- |
| `job-search` | Fan-out across sources, dedupe, persist | 2 per user |
| `job-analysis` | LLM relevance scoring | 5, LLM rate limited |
| `cv-generation` | Tailor + render DOCX/PDF | 3 |
| `contact-discovery` | Permitted public lookups | 1, politely rate limited |
| `outreach-send` | Approved messages only | 1 |

Every queue gets exponential backoff, a retry cap, a dead-letter destination and
an idempotency key, so a retried job cannot create a second application or send
a message twice. Progress reaches the browser over SSE rather than polling.
