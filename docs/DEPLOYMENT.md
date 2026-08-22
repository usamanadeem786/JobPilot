# Deployment

## What has to run

JobPilot is four things, not one:

| Component | Needs |
| --- | --- |
| `apps/web` | Node runtime or any Next.js host |
| `apps/api` | A **long-lived** Node process (persistent connections, SSE) |
| PostgreSQL 16 | With the `vector`, `pg_trgm` and `citext` extensions |
| Redis 7 | Queues and, later, rate-limit storage |

`apps/workers` (Phase 3) is a fifth process sharing the API's image.

## Hosting options

### Vercel for the frontend, a container host for the rest

Vercel is an excellent host for `apps/web` and a poor fit for `apps/api`:
Vercel's functions are request-scoped and stateless, while the API holds a
Prisma connection pool, runs BullMQ workers and streams SSE for the duration of
a job search. Those need a process that outlives a request.

A working split:

- **`apps/web` → Vercel.** Push the repository to GitHub, then *Add New →
  Project* in the Vercel dashboard and import it. The root `vercel.json`
  already sets the framework, install command and build command (it builds
  `@jobpilot/shared` first, which the web app imports). The one thing the file
  cannot set is **Root Directory** — choose `apps/web` in the import dialog.

  Set `NEXT_PUBLIC_API_URL` to the deployed API's URL under *Settings →
  Environment Variables* **before the first build**: `NEXT_PUBLIC_*` values are
  inlined into the client bundle at build time, so changing one later requires
  a redeploy, not just a restart. Until it points at a running API, the site
  renders but sign-in fails — the browser has nothing to authenticate against.
- **`apps/api` + `apps/workers` → Railway, Render, Fly.io, or any container
  platform.** Build from `apps/api/Dockerfile`.
- **PostgreSQL → Neon, Supabase, Railway or RDS.** Confirm `pgvector` is
  available; Neon and Supabase both offer it.
- **Redis → Upstash, Railway or ElastiCache.**

Both origins must be set correctly or the browser will silently drop the
session cookie: `CORS_ORIGINS` on the API must list the exact web origin, and
the two must share a registrable domain (`app.example.com` and
`api.example.com`) for the `SameSite=Lax` refresh cookie to be sent. If they are
on unrelated domains (`app.vercel.app` and `api.railway.app`), the cookie is
cross-site and will not be attached — put both behind one domain, or change the
cookie to `SameSite=None; Secure` in `refresh-cookie.ts` and accept the
weaker CSRF posture.

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
