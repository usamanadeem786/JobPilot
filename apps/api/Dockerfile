# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# JobPilot API — multi-stage build.
#
# The final image contains only production dependencies and compiled output;
# no source, no dev toolchain, and it runs as a non-root user.
# ---------------------------------------------------------------------------

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

# --- Dependencies ----------------------------------------------------------
FROM base AS deps
# Copy only manifests first so a source-only change reuses the install layer.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/config/package.json packages/config/
COPY packages/shared/package.json packages/shared/
COPY packages/database/package.json packages/database/
COPY apps/api/package.json apps/api/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# --- Build -----------------------------------------------------------------
FROM deps AS build
COPY packages/config packages/config
COPY packages/shared packages/shared
COPY packages/database packages/database
COPY apps/api apps/api
RUN pnpm --filter @jobpilot/database generate \
 && pnpm --filter @jobpilot/shared build \
 && pnpm --filter @jobpilot/database build \
 && pnpm --filter @jobpilot/api build

# Strip dev dependencies from the tree we are about to copy out.
RUN pnpm --filter @jobpilot/api --prod deploy /app/bundle \
 && cp -r apps/api/dist /app/bundle/dist \
 && cp -r packages/database/prisma /app/bundle/prisma

# --- Runtime ---------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production
# OpenSSL is required by Prisma's query engine.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY --from=build --chown=node:node /app/bundle /app
RUN mkdir -p /app/storage && chown -R node:node /app/storage

USER node
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/main.js"]
