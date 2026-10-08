# syntax=docker/dockerfile:1
# Server image for api-public, api-admin, worker and migrate (one image; the command selects the process).
# Build context = repository root:  docker build -f infra/docker/server.Dockerfile --target runtime .
# Base images are pinned by digest (04 §2 R9); Renovate proposes updates.

ARG NODE_IMAGE=node:24.21.0-trixie-slim@sha256:173f125896c3b47ddf056734c7ea789d04595a6a08769a8f78e0df642781fb66
ARG RUNTIME_IMAGE=gcr.io/distroless/nodejs24-debian13:nonroot@sha256:9eeb7f5887d0e239e78264b06f7f11d2e14be534050481803a9e4728fcdd278e

# ---------------------------------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=true \
    LEFTHOOK=0 \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo

# ---------------------------------------------------------------------------------------------------
# Dependencies: fetched from the lockfile alone (cached layer), then installed offline.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
# Installs the exact pnpm version from package.json "packageManager".
RUN corepack install
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm fetch
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile --offline

# ---------------------------------------------------------------------------------------------------
# Build the server bundles and prune to production dependencies (bullmq + ioredis — DECISIONS #34).
FROM deps AS build
RUN pnpm --filter @mc/server build && \
    rm -f apps/server/dist/*.map
# deploy copies the package (incl. dist/, per "files" in package.json) + its production node_modules.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --filter @mc/server --prod deploy /out

# ---------------------------------------------------------------------------------------------------
# Runtime: distroless (no shell, no package manager), non-root user 65532.
FROM ${RUNTIME_IMAGE} AS runtime
ARG RELEASE=dev
ENV NODE_ENV=production \
    RELEASE=${RELEASE}
WORKDIR /app
COPY --from=build --chown=65532:65532 /out/node_modules ./node_modules
COPY --from=build --chown=65532:65532 /out/package.json ./package.json
COPY --from=build --chown=65532:65532 /out/dist ./dist
USER 65532:65532
# Default checks api-public; compose overrides the healthcheck for api-admin and worker.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
    CMD ["/nodejs/bin/node", "dist/healthcheck.mjs", "api-public"]
# Distroless entrypoint is node; the command selects the process: dist/public.mjs | admin.mjs | worker.mjs | migrate.mjs
CMD ["dist/public.mjs"]
