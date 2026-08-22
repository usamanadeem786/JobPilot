# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# JobPilot API.
#
# The build context is the REPOSITORY ROOT, not apps/api — the image needs the
# whole pnpm workspace to resolve the `workspace:*` dependencies on
# packages/shared and packages/database. On Railway that means leaving Root
# Directory at "/" and pointing at this file through railway.json.
#
# The runtime image keeps the installed workspace rather than extracting a
# pruned bundle. `pnpm deploy` would be smaller, but its semantics changed in
# pnpm 10 (it now needs --legacy or inject-workspace-packages), and an image
# that builds reliably beats a lean one that breaks on a pnpm upgrade. Keeping
# the tree also leaves the Prisma CLI available, which is what runs migrations
# on deploy.
# ---------------------------------------------------------------------------

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
# OpenSSL is required by Prisma's query engine.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && corepack enable
WORKDIR /app

# --- Build -----------------------------------------------------------------
FROM base AS build

# Manifests first, so a source-only change reuses the install layer.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY packages/config/package.json packages/config/
COPY packages/shared/package.json packages/shared/
COPY packages/database/package.json packages/database/
COPY apps/api/package.json apps/api/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

COPY packages/config packages/config
COPY packages/shared packages/shared
COPY packages/database packages/database
COPY apps/api apps/api

RUN pnpm --filter @jobpilot/database generate \
 && pnpm --filter @jobpilot/shared build \
 && pnpm --filter @jobpilot/database build \
 && pnpm --filter @jobpilot/api build

# --- Runtime ---------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production

COPY --from=build --chown=node:node /app /app

# Uploaded CVs land here when STORAGE_DRIVER=local. Use S3 in production: a
# container filesystem does not survive a redeploy.
RUN mkdir -p /app/storage && chown -R node:node /app/storage

USER node
WORKDIR /app/apps/api
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/main.js"]
