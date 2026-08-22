# JobPilot

An AI job search, CV tailoring and application tracking platform.

Find roles from job sources that permit programmatic access, rank them against
your CV, tailor that CV per job without inventing anything, and track every
application in one place.

**Status: Phase 1 complete.** Foundation, authentication and the app shell are
built and tested. Job search, CV parsing and AI features land in later phases —
see [docs/ROADMAP.md](docs/ROADMAP.md). Screens that are not built yet say so
rather than showing placeholder data.

---

## Ground rules

This system does not scrape sites that prohibit it, does not bypass CAPTCHAs,
logins, rate limits or paywalls, does not guess anyone's email address, and does
not send a message without you approving it first.

Sources that need a partner agreement (LinkedIn, Indeed, Glassdoor) ship
**disabled** and report "not configured" until you supply real credentials.
Where a platform forbids automated applications — which is nearly all of them —
you get an *Apply manually* action that opens the official application page.

[docs/COMPLIANCE.md](docs/COMPLIANCE.md) explains each of these decisions.

---

## Requirements

- Node.js 22+
- pnpm 10+ (`corepack enable`)
- Docker Desktop (PostgreSQL and Redis)

## Getting started

```bash
pnpm install
```

```bash
cp .env.example .env
```

Then generate the three secrets `.env` needs. On macOS or Linux:

```bash
printf 'JWT_ACCESS_SECRET=%s\nJWT_REFRESH_SECRET=%s\nENCRYPTION_KEY=%s\n' "$(openssl rand -base64 48)" "$(openssl rand -base64 48)" "$(openssl rand -base64 32)"
```

On Windows PowerShell:

```powershell
node -e "const c=require('crypto');console.log('JWT_ACCESS_SECRET='+c.randomBytes(48).toString('base64'));console.log('JWT_REFRESH_SECRET='+c.randomBytes(48).toString('base64'));console.log('ENCRYPTION_KEY='+c.randomBytes(32).toString('base64'))"
```

Paste those three values into `.env`, replacing the placeholders. The API
refuses to start if any of them is still the placeholder, too short, or the
wrong length — a misconfigured deployment fails at boot rather than running with
a weak key.

Start PostgreSQL and Redis:

```bash
pnpm infra:up
```

> The containers use ports **5433** and **6380**, not the defaults, so they do
> not collide with a PostgreSQL or Redis already installed on your machine.

Create the schema and seed reference data:

```bash
pnpm db:migrate
```

```bash
pnpm db:seed
```

Run both apps:

```bash
pnpm dev
```

- Web: http://localhost:3000
- API: http://localhost:4000/api
- Health: http://localhost:4000/api/health/ready

Register an account at http://localhost:3000/register.

## Tests

```bash
pnpm test
```

API integration tests run against the database in `DATABASE_URL` (override with
`TEST_DATABASE_URL`). They skip themselves with a warning if no database is
reachable, so the unit suites stay useful with nothing else running.

## Useful commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Run web and API together |
| `pnpm build` | Build every package and app |
| `pnpm test` | Run all test suites |
| `pnpm typecheck` | Typecheck every package |
| `pnpm lint` | Lint every package |
| `pnpm db:studio` | Open Prisma Studio |
| `pnpm db:migrate` | Create and apply a migration |
| `pnpm infra:up` / `infra:down` | Start / stop the containers |
| `pnpm infra:reset` | Stop containers **and delete their volumes** |

## Layout

```
apps/api        NestJS API — auth, jobs, CVs, contacts
apps/web        Next.js frontend
apps/workers    BullMQ processors (Phase 3)
packages/shared     Zod schemas and types used by both apps
packages/database   Prisma schema, migrations, seed
packages/config     Shared tsconfig and ESLint
packages/ai         LLM abstraction and prompts (Phase 5)
packages/job-sources Source adapters (Phase 3)
packages/cv         Parsing and document generation (Phase 2)
```

## Documentation

| Document | Contents |
| --- | --- |
| [Architecture](docs/ARCHITECTURE.md) | System design, technology decisions, adapter and AI architecture |
| [Compliance](docs/COMPLIANCE.md) | What the brief asked for, what platforms allow, and what was built instead |
| [API](docs/API.md) | Endpoints, error contract, planned surface |
| [Security](docs/SECURITY.md) | Auth, tokens, uploads, secrets, audit |
| [Roadmap](docs/ROADMAP.md) | Phases 1–10 |
| [Deployment](docs/DEPLOYMENT.md) | Production deployment and hosting options |
