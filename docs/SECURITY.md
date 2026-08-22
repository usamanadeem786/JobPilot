# Security architecture

## Authentication

**Passwords** are hashed with Argon2id at OWASP's recommended second
configuration (19 MiB, t=2, p=1, `@node-rs/argon2`). Stored hashes are upgraded
transparently on next login when the parameters fall behind current settings.
The policy is 12 characters minimum with upper case, lower case and a digit —
length carries the weight; there is no symbol requirement to fight password
managers.

**User enumeration is closed.** A login for an unknown email verifies the
password against a real Argon2 hash generated at boot, so the failure takes
comparable time and returns the identical `INVALID_CREDENTIALS` code and message
as a wrong password. An e2e test asserts both responses match.

**Tokens.** A short-lived access JWT (15 min default) is held in browser memory
only — never `localStorage`, which any XSS can read. The long-lived refresh
token is an httpOnly, `SameSite=Lax` cookie scoped to `/api/auth`, so page
JavaScript cannot read it at all. Access and refresh are signed with *different*
secrets, and boot fails if they match.

**Rotation with reuse detection.** Refresh tokens are single-use and belong to a
family. Rotating one revokes it via a compare-and-swap (`updateMany` on
`revokedAt IS NULL`), so two concurrent uses cannot both succeed. Presenting an
already-rotated token revokes the whole family and forces a fresh sign-in.
Only SHA-256 hashes are stored, so a database leak yields no usable sessions.
The client coalesces concurrent refreshes into a single request, so ordinary
parallel API calls are never mistaken for theft.

**Authorization** is deny-by-default: `JwtAuthGuard` is registered globally and
a route opts out with `@Public()`. Forgetting a decorator produces a locked
endpoint, not an open one. `RolesGuard` and the `Role` enum carry the
admin/user split.

## Input handling

Every request body is parsed by a Zod schema from `@jobpilot/shared` — the same
object the browser validates with. The pipe replaces the raw input with the
parsed result, so handlers only ever see trimmed, coerced, known keys. Unknown
keys are stripped, which closes mass-assignment.

SQL injection is structurally prevented by Prisma's parameterised queries. The
one place raw SQL will appear (pgvector similarity in Phase 5) uses
`$queryRaw` tagged templates, which parameterise; `$queryRawUnsafe` is not used.

## Transport and headers

`helmet` sets `Content-Security-Policy: default-src 'none'`, `nosniff`,
`no-referrer`, `frame-ancestors 'none'`, and HSTS in production.
`x-powered-by` is removed. CORS uses an explicit origin allowlist — never a
reflected origin, which combined with `credentials: true` would let any site
call the API with the user's cookies. Boot fails in production if
`CORS_ORIGINS` is empty.

**CSRF.** The refresh cookie is `SameSite=Lax` and the only endpoints that
consume it are POST. Browsers do not attach Lax cookies to cross-site POSTs, so
a third-party page cannot trigger a refresh. Every other authenticated endpoint
requires a `Authorization` header, which a cross-site form cannot set.

## Rate limiting

Two named throttlers: 120 req/min globally, and a 5 req/min tier applied to
register, login and change-password. `THROTTLE_ENABLED` exists for deployments
that already rate limit at a gateway. `rate-limit.e2e.test.ts` boots the app
with the real guard and asserts the 429, so the limit cannot silently regress.

## File uploads (Phase 2)

Validated by extension **and** content sniffing — a `.pdf` extension on a
different file type is rejected. `MAX_UPLOAD_BYTES` caps size (10 MB default).
Files are stored outside the web root under a generated `storageKey`, never
under the user's filename, and a SHA-256 checksum is recorded.
`FileObject.scanStatus` carries the malware-scan lifecycle; when `CLAMAV_HOST`
is configured the scan runs before the file is usable, and when it is not the
status is `SKIPPED` — visibly, rather than silently pretending a scan happened.

## Secrets and data at rest

Secrets come only from environment variables, validated at boot: JWT secrets
must be ≥32 characters and must not still hold the `.env.example` placeholder,
and `ENCRYPTION_KEY` must decode to exactly 32 bytes. A misconfigured deployment
fails loudly at startup rather than running with a weak default.

No secret is exposed to the browser. Only `NEXT_PUBLIC_*` values reach the
client bundle, and those are just the API URL and the app name. LLM and
job-source keys live in the API process; the frontend never calls a third-party
API directly.

Personal data that must be stored but never queried on is encrypted with
AES-256-GCM (`EncryptionService`), versioned as `v1:` so the format can evolve.
GCM authenticates, so tampering fails closed. Today that covers the profile
phone number.

## Logging and audit

`pino` writes structured JSON with a per-request id echoed in the
`x-request-id` header and in every error body. Authorization headers, cookies,
`set-cookie`, and every password or token field are redacted at the logger, so
they cannot reach the log stream even at trace level.

`AuditLog` is an append-only record of registrations, logins (including
failures, with the reason), logouts, refreshes, detected token reuse, password
changes and profile edits — with actor, IP, user agent and request id. Audit
writes are best-effort: a failed audit insert is logged loudly but never turns a
successful user action into a failed request.

## Error handling

`AllExceptionsFilter` catches everything and emits one body shape. 5xx errors
are logged in full server-side and replied to with a generic message, so stack
traces, Prisma metadata and internal paths never reach a client. Known Prisma
errors are mapped to proper HTTP semantics (unique violation → 409, not found →
404) rather than leaking as 500s.

## Known gaps for later phases

- Email verification and password reset (Phase 2) — `emailVerified` exists but
  nothing sets it yet.
- OAuth sign-in (Phase 2) — `OAuthAccount` and the config slots exist; no
  provider is wired.
- Redis-backed throttler storage — the in-memory store is per-instance, so
  limits are per-process until the API is horizontally scaled.
- Expired `RefreshToken` pruning is implemented (`TokenService.pruneExpired`)
  but not yet scheduled.
- 2FA is not implemented.
