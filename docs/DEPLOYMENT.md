# Deployment

## What has to run

| Component | Needs | Phase 1 status |
| --- | --- | --- |
| `apps/web` | Any Next.js host | Vercel |
| `apps/api` | Node runtime | Vercel serverless, or a container host |
| PostgreSQL 16 | `vector`, `pg_trgm`, `citext` extensions | Required |
| Redis 7 | Queues and distributed rate limiting | **Not needed until Phase 3** |
| `apps/workers` | A **long-lived** process | Phase 3 |

## Hosting options

### Everything on Vercel (Phase 1)

This works today, with one caveat worth understanding before you rely on it.

Vercel runs the API as a serverless function: request-scoped, no process
between requests. For the API as it currently stands that is fine — it is a
stateless REST service over Postgres. The parts that genuinely need a
long-lived process are **Phase 3 features that do not exist yet**: the BullMQ
workers that run job searches in the background, and the SSE stream that
reports their progress. When those land, `apps/workers` will need a host that
runs a real process (Railway, Render, Fly). The API itself can stay on Vercel.

Two other serverless consequences to plan for:

- **Connection pooling.** Each warm function instance holds its own Prisma
  pool, so many instances can exhaust Postgres connections. Use a pooled
  connection string — Neon and Supabase both provide one (Neon's has
  `-pooler` in the host). This matters more as traffic grows.
- **Cold starts.** The first request after idle pays the Nest bootstrap. The
  handler caches the app across warm invocations, so it is a per-instance cost,
  not a per-request one.

Vercel does **not** provide a database. Attach one from the Marketplace
(Neon has a first-party integration that sets `DATABASE_URL` for you) or create
one at neon.tech / supabase.com and paste the string in.

#### Two Vercel projects, one repository

| Project | Root Directory | Serves |
| --- | --- | --- |
| `jobpilot-web` | `apps/web` | The Next.js frontend |
| `jobpilot-api` | `apps/api` | The NestJS API, via `apps/api/vercel.json` |

Both import the same GitHub repository. `apps/api/vercel.json` routes every
path to `api/index.ts`, which boots Nest from the compiled `dist/` — Vercel's
esbuild does not emit the decorator metadata Nest needs, so the handler
deliberately imports the tsc output rather than the source.

#### Steps

1. **Create the database.** Neon, with pgvector enabled:
   `CREATE EXTENSION IF NOT EXISTS vector;` in its SQL editor. `pg_trgm` and
   `citext` are created by the migration.
2. **Run the migration from your machine** against that database — no local
   Docker needed:
   ```bash
   cd "path/to/jobpilot" && DATABASE_URL="<your-neon-url>" pnpm --filter @jobpilot/database exec prisma migrate deploy
   ```
   Then seed the job sources and CV templates:
   ```bash
   cd "path/to/jobpilot" && DATABASE_URL="<your-neon-url>" pnpm --filter @jobpilot/database exec tsx prisma/seed.ts
   ```
3. **Deploy the API project** with Root Directory `apps/api` and the variables
   in the table below.
4. **Deploy the web project** with Root Directory `apps/web`, setting
   `NEXT_PUBLIC_API_URL` to `https://<your-api-project>.vercel.app/api`.
5. **Go back to the API project** and set `CORS_ORIGINS` to the web project's
   exact URL, then redeploy it.

#### Variables on the API project

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Your pooled Postgres connection string |
| `JWT_ACCESS_SECRET` | 48 random bytes, base64 |
| `JWT_REFRESH_SECRET` | 48 random bytes, base64 — **different** from the access secret |
| `ENCRYPTION_KEY` | Exactly 32 random bytes, base64 |
| `CORS_ORIGINS` | The web project's exact URL, e.g. `https://jobpilot-web.vercel.app` |
| `COOKIE_SAMESITE` | `none` — the two projects are on different subdomains of `vercel.app`, which is a public suffix, so they count as separate sites |
| `HTTP_USER_AGENT` | `JobPilot/0.1 (+https://your-site; you@example.com)` |

Do not set `API_PORT` or `PORT`; Vercel owns the socket. `REDIS_URL` is
optional until Phase 3. Everything else in `.env.example` disables its own
feature when absent, and the API reports "not configured" rather than failing.

Generate the three secrets with:

```bash
node -e "const c=require('crypto');console.log('JWT_ACCESS_SECRET='+c.randomBytes(48).toString('base64'));console.log('JWT_REFRESH_SECRET='+c.randomBytes(48).toString('base64'));console.log('ENCRYPTION_KEY='+c.randomBytes(32).toString('base64'))"
```

#### Only on the web project

`API_PROXY_TARGET`, set to the API project's origin (no trailing path), e.g.
`https://jobpilot-api.vercel.app`.

**It must be present at build time.** Next compiles rewrites into
`routes-manifest.json` during `next build`, so a value supplied only at runtime
produces a build with no rewrite, and every `/api` call falls through to the
Next router and returns 404. On Vercel that means adding the variable *before*
the deploy, and redeploying after any change — the same rule as a
`NEXT_PUBLIC_*` value, despite this one never reaching the browser.

`NEXT_PUBLIC_API_URL` is only needed if you deliberately bypass the proxy and
point the browser straight at the API, which then requires `CORS_ORIGINS` and
`COOKIE_SAMESITE=none`. Never put a secret in the web project: `NEXT_PUBLIC_*`
values ship to every visitor's browser in plain text.

### Vercel for the frontend, a container host for the API

Preferable once Phase 3 lands, because the workers need a real process anyway
and can then share the API's image.

- **`apps/web` → Vercel, imported from GitHub.** Push the repository, then
  *Add New → Project* in the Vercel dashboard, import it, and set **Root
  Directory** to `apps/web`. Leave everything else on its default: Vercel
  detects Next.js and pnpm, installs the whole workspace from the repository
  root, and runs `apps/web`'s own `build` script — which builds
  `@jobpilot/shared` first, because the web app imports it.

  Do not try to deploy this with `vercel deploy` from a bare file upload. A
  file-upload deployment with a root directory set only carries that subtree,
  so the sibling workspace packages vanish and pnpm fails with
  `No matching version found for @jobpilot/config@* inside the workspace`.
  Monorepo support lives in the git integration.

  Set `NEXT_PUBLIC_API_URL` to the deployed API's URL under *Settings →
  Environment Variables* **before the first build**: `NEXT_PUBLIC_*` values are
  inlined into the client bundle at build time, so changing one later requires
  a redeploy, not just a restart. Until it points at a running API, the site
  renders but sign-in fails — the browser has nothing to authenticate against.
- **`apps/api` → Railway.** See "Railway, step by step" below.
- **PostgreSQL → Neon, Supabase, Railway or RDS.** Confirm `pgvector` is
  available; Neon and Supabase both offer it.
- **Redis → Upstash, Railway or ElastiCache.**

Both origins must be set correctly or the browser will silently drop the
session cookie. `CORS_ORIGINS` on the API must list the exact web origin, and
the cookie's SameSite policy has to match your domain layout:

| Layout | `COOKIE_SAMESITE` | Why |
| --- | --- | --- |
| `app.example.com` + `api.example.com` | `lax` | Same registrable domain, so a Lax cookie is sent. Keeps SameSite's CSRF protection. |
| `jobpilot.vercel.app` + `jobpilot-api.up.railway.app` | `none` | Unrelated domains. A Lax cookie is never sent, so sign-in appears to work and then the session vanishes on reload. |

`none` gives up the CSRF protection SameSite provides, leaving the CORS
allowlist as the defence — so keep `CORS_ORIGINS` tight. It also requires HTTPS,
which the API enforces by refusing to boot with `COOKIE_SAMESITE=none` outside
production.

## Railway, step by step

`railway.json` at the repository root already selects the Dockerfile builder,
the migration pre-deploy step and the health check. What Railway needs from you:

1. **New Project → Deploy from GitHub repo**, pick `JobPilot`.
2. Leave **Root Directory** empty. The Dockerfile's build context must be the
   repository root, or the pnpm workspace packages are not present and the
   build fails to resolve `@jobpilot/shared`.
3. **Add a PostgreSQL** and a **Redis** database to the same project. Railway
   injects `DATABASE_URL` and `REDIS_URL` automatically — reference them as
   `${{Postgres.DATABASE_URL}}` and `${{Redis.REDIS_URL}}`.
4. Enable `pgvector` once, from the Postgres service's query console:
   `CREATE EXTENSION IF NOT EXISTS vector;` Railway's Postgres image includes
   it, but the extension still has to be created. `pg_trgm` and `citext` are
   created by the migration itself.
5. Set the variables below, then deploy. `preDeployCommand` runs
   `prisma migrate deploy` before the new version takes traffic.
6. **Generate a domain** on the service, then set `NEXT_PUBLIC_API_URL` in
   Vercel to `https://<that-domain>/api` and redeploy the frontend.

### Variables to set on the Railway service

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
| `REDIS_URL` | `${{Redis.REDIS_URL}}` |
| `JWT_ACCESS_SECRET` | 48 random bytes, base64 |
| `JWT_REFRESH_SECRET` | 48 random bytes, base64 — **different** from the access secret |
| `ENCRYPTION_KEY` | exactly 32 random bytes, base64 |
| `CORS_ORIGINS` | your exact Vercel URL, e.g. `https://jobpilot.vercel.app` |
| `COOKIE_SAMESITE` | `none` (Vercel and Railway are unrelated domains) |
| `HTTP_USER_AGENT` | `JobPilot/0.1 (+https://your-site; you@example.com)` |
| `LOG_LEVEL` | `info` |

Do **not** set `API_PORT`. Railway assigns `PORT` and the API binds to it.

Generate the three secrets with:

```bash
node -e "const c=require('crypto');console.log('JWT_ACCESS_SECRET='+c.randomBytes(48).toString('base64'));console.log('JWT_REFRESH_SECRET='+c.randomBytes(48).toString('base64'));console.log('ENCRYPTION_KEY='+c.randomBytes(32).toString('base64'))"
```

Everything else in `.env.example` is optional: the LLM keys, job-source
credentials and SMTP settings each disable their feature when absent, and the
API reports "not configured" rather than failing.

### Everything on one container platform

Simpler, and avoids the cross-domain cookie problem entirely. Deploy both
images behind one domain with a path split (`/` → web, `/api` → API).
`docker-compose.yml` already describes this shape:

```bash
docker compose --profile full up -d --build
```

That is a working reference, not a production topology — it runs the database
in a container on the same host.

## Before going live

**Environment.** Every variable in `.env.example` must be set with real values.
The API validates at boot and refuses to start on a weak or placeholder secret,
so a bad rollout fails fast instead of running insecurely. In particular:

- `NODE_ENV=production` — enables HSTS and the secure cookie flag
- `CORS_ORIGINS` — must be set, or boot fails
- `JWT_ACCESS_SECRET` ≠ `JWT_REFRESH_SECRET`, both ≥32 chars
- `ENCRYPTION_KEY` — exactly 32 bytes, base64. **Losing this makes every
  encrypted field unreadable.** Back it up in a secret manager, not in the repo.
- `HTTP_USER_AGENT` — a real identifier with a contact address

**Migrations** run as a release step, before the new version starts:

```bash
pnpm db:deploy
```

Never `migrate dev` in production — it can prompt and can reset.

**TLS and proxying.** Terminate TLS at the load balancer. The API sets
`trust proxy`, so `X-Forwarded-For` must be populated or the audit log and rate
limiter will only ever see the proxy's address.

**Health checks.** Point liveness at `/api/health` and readiness at
`/api/health/ready`. Readiness returns 503 with per-dependency detail when the
database is unreachable, so an instance that cannot serve is taken out of
rotation.

**Scaling.** The API is stateless apart from its in-memory rate limiter, so it
scales horizontally — but until the throttler is moved to Redis (Phase 10),
limits are per-instance, so N instances means N× the effective limit. Workers
scale independently; BullMQ handles distribution.

**Backups.** Nightly PostgreSQL dumps with point-in-time recovery. If
`STORAGE_DRIVER=s3`, enable bucket versioning — uploaded CVs are user data you
cannot regenerate.

**Monitoring.** Ship the JSON logs to a platform that can search on
`requestId`. Alert on 5xx rate, readiness failures, queue depth, failed jobs,
and LLM error rate.

## Deployment checklist

- [ ] Secrets generated fresh for this environment and stored in a secret manager
- [ ] `ENCRYPTION_KEY` backed up separately
- [ ] `CORS_ORIGINS` lists the exact production web origin
- [ ] `pnpm db:deploy` runs before the new version starts
- [ ] `pgvector`, `pg_trgm` and `citext` available on the database
- [ ] TLS terminated; `X-Forwarded-For` populated
- [ ] Health checks wired to `/api/health` and `/api/health/ready`
- [ ] Backups scheduled and a restore tested
- [ ] Log aggregation and alerts configured
- [ ] Each job source reviewed against its current terms before enabling
