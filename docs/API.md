# API design

Base URL: `http://localhost:4000/api` (`API_GLOBAL_PREFIX`).

Every endpoint is authenticated unless marked **public**. Authentication is a
`Authorization: Bearer <accessToken>` header; the refresh token travels only as
an httpOnly cookie scoped to `/api/auth`.

## Conventions

**Errors.** Every non-2xx response has the same body:

```json
{
  "statusCode": 409,
  "code": "EMAIL_ALREADY_REGISTERED",
  "message": "An account with this email already exists.",
  "fieldErrors": [{ "path": "email", "message": "…" }],
  "requestId": "7c3f…",
  "timestamp": "2026-08-22T00:00:00.000Z",
  "path": "/api/auth/register"
}
```

`code` is from the `ErrorCode` union in `@jobpilot/shared`, so the client
branches on a constant rather than parsing prose. `requestId` matches the
`x-request-id` header and the server logs.

**Lists** are `{ items: T[], meta: { page, pageSize, total, totalPages, hasNextPage, hasPreviousPage } }`,
with `?page` and `?pageSize` (max 100).

**Validation** happens against the shared Zod schemas. Unknown keys are
stripped, strings trimmed, and failures return `VALIDATION_FAILED` with
`fieldErrors`.

---

## Phase 1 — shipped

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/health` | public | Liveness. Never touches dependencies. |
| `GET` | `/health/ready` | public | Readiness. 200 when every dependency is up, 503 with per-dependency detail otherwise. |
| `POST` | `/auth/register` | public | Create an account. 201 with `AuthSession`, sets the refresh cookie. |
| `POST` | `/auth/login` | public | 200 with `AuthSession`, sets the refresh cookie. |
| `POST` | `/auth/refresh` | public (cookie) | Rotates the token pair. Replay of a rotated token returns `TOKEN_REUSE_DETECTED` and kills the family. |
| `POST` | `/auth/logout` | public (cookie) | 204. Revokes the presented token, clears the cookie. |
| `POST` | `/auth/logout-all` | user | Revokes every live session. |
| `POST` | `/auth/change-password` | user | 204. Revokes all sessions. |
| `GET` | `/users/me` | user | The authenticated user. |
| `GET` | `/users/me/profile` | user | Profile, phone decrypted. |
| `PATCH` | `/users/me/profile` | user | Partial update; absent keys are left alone. |

`AuthSession` is `{ user: AuthUser, tokens: { accessToken, expiresIn, tokenType } }`.
The refresh token is deliberately **not** in the body.

Rate limits: 5/min on register, login and change-password; 20/min on refresh;
120/min globally.

---

## Planned surface

Shapes are fixed now so the client can be written against them; each lands with
its phase.

### CVs — Phase 2 / 6

```
POST   /cv/upload                 multipart, PDF or DOCX → MasterCV
GET    /cv                        list master CVs
GET    /cv/:id                    one master CV with its structured content
PATCH  /cv/:id                    edit structured content (autosaved)
DELETE /cv/:id
POST   /cv/:id/set-default
POST   /cv/:id/tailor             { jobId, templateId } → TailoredCV (queued)
GET    /cv/tailored/:id
PATCH  /cv/tailored/:id           manual edits before download
POST   /cv/tailored/:id/regenerate
GET    /cv/tailored/:id/download  ?format=pdf|docx
GET    /cv/templates
```

### Jobs — Phases 3–5

```
POST   /jobs/search               → 202 { searchId }, work runs in the background
GET    /jobs/searches             history
GET    /jobs/searches/:id         status, counts, per-source outcome
GET    /jobs/searches/:id/events  SSE progress stream
DELETE /jobs/searches/:id         cancel a running search

GET    /jobs                      filter, sort, paginate the user's jobs
GET    /jobs/latest               ?keyword=&limit=  jobs with a known posting date
GET    /jobs/:id
PATCH  /jobs/:id                  status, notes, favourite
DELETE /jobs/:id                  removes it from the user's list, not the canonical job
POST   /jobs/:id/analyze          → JobAnalysis
POST   /jobs/:id/generate-cv      → TailoredCV (queued)
GET    /jobs/:id/contacts
POST   /jobs/bulk                 { jobIds, action } — generate CVs, set status, archive
GET    /jobs/sources              adapters with their configured/health state
```

`POST /jobs/search` returns 202 immediately. A large search must never hold an
HTTP request open.

### Applications — Phase 7

```
GET    /applications
POST   /applications              { jobId, tailoredCvId?, method }
GET    /applications/:id
PATCH  /applications/:id          status, appliedAt, interviewDate, notes
POST   /applications/:id/submit   403 AUTOMATED_APPLICATION_NOT_PERMITTED
                                  unless the source explicitly allows it
GET    /applications/:id/events
```

### Contacts and outreach — Phases 8–9

```
GET    /contacts                  ?companyId=&jobId=
POST   /contacts/discover         { jobId } → queued lookup via permitted sources
GET    /outreach
POST   /outreach/generate         { contactId, jobId } → OutreachDraft (DRAFT)
PATCH  /outreach/:id              edit the body
POST   /outreach/:id/approve      the human gate; required before sending
POST   /outreach/:id/send         409 OUTREACH_NOT_APPROVED without approval
```

### Analytics and export — Phase 10

```
GET    /analytics/summary         dashboard cards
GET    /analytics/timeseries      ?metric=jobs|applications&from=&to=
POST   /exports/jobs              { format: 'csv' | 'xlsx', filters } → file
```

---

## Why REST rather than GraphQL

The client's needs are a small set of well-known screens, the heavy operations
are commands (`search`, `tailor`, `send`) rather than graph traversals, and
per-endpoint rate limiting matters here. GraphQL's strengths — flexible
selection, avoiding round trips — would mostly buy complexity, and the
`@jobpilot/shared` types already give end-to-end type safety without it.
