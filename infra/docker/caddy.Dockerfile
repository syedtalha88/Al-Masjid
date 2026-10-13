# syntax=docker/dockerfile:1
# Caddy image for both origins (static SPAs + reverse proxy). Runs as a non-root user on ports 8443/8080
# (04 §12.2); the host maps 443 → 8443. Build context = repository root.
#   docker build -f infra/docker/caddy.Dockerfile --target base .      (local stack: dist mounted)
#   docker build -f infra/docker/caddy.Dockerfile --target runtime .   (staging/production: dist baked in — T0.14)

ARG CADDY_IMAGE=caddy:2.11.7-alpine@sha256:d8542f48d34a9cf4e4c11a478865229840e87e4c96ea3f439101f31a5d35f75f
ARG NODE_IMAGE=node:24.21.0-trixie-slim@sha256:173f125896c3b47ddf056734c7ea789d04595a6a08769a8f78e0df642781fb66
ARG CADDY_BUILDER_IMAGE=caddy:2.11.7-builder-alpine@sha256:d6161a2c82fd58b3205048958fb6246d0c5d892beee8a47e90944610c4efd100

# ---------------------------------------------------------------------------------------------------
# Caddy 2.11.7 compiled from source (DECISIONS #49): the official 2.11.7 binary is built with Go 1.26.8 and
# golang.org/x/net 0.59.0, which carry HIGH HTTP/2 + Range-header DoS CVEs (Trivy, 14 Oct 2026). The builder
# image ships Go 1.27.2; x/net is raised to the fixed 0.60.0. Back to the official binary once a Caddy release
# includes the fixes (PROGRESS F24). The result has no file capabilities (non-root, high ports only).
FROM ${CADDY_BUILDER_IMAGE} AS caddy-build
RUN xcaddy build v2.11.7 \
      --output /usr/bin/caddy \
      --replace golang.org/x/net=golang.org/x/net@v0.60.0

FROM ${CADDY_IMAGE} AS base
COPY --from=caddy-build /usr/bin/caddy /usr/bin/caddy
RUN addgroup -S -g 1000 caddy && adduser -S -u 1000 -G caddy -H -s /sbin/nologin caddy
COPY infra/caddy/Caddyfile /etc/caddy/Caddyfile
USER 1000:1000
EXPOSE 8443 8080

# ---------------------------------------------------------------------------------------------------
# Both PWAs built for one environment. VITE_PUBLIC_* are public by definition (they end up in the bundle) and
# come from the GitHub environment's variables as build args; every other variable is refused by the build
# (parseClientEnv) and scanned for afterwards. Source maps are removed (uploaded to Sentry in CI — T0.13).
FROM ${NODE_IMAGE} AS web-build
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=true \
    LEFTHOOK=0 \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN corepack install
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm fetch
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile --offline
ARG RELEASE=dev
ARG VITE_PUBLIC_API_BASE \
    VITE_PUBLIC_APP_ORIGIN \
    VITE_PUBLIC_MEDIA_ORIGIN \
    VITE_PUBLIC_VAPID_PUBLIC_KEY \
    VITE_PUBLIC_TURNSTILE_SITE_KEY \
    VITE_PUBLIC_SENTRY_DSN
RUN MC_RELEASE="${RELEASE}" pnpm --filter @mc/app --filter @mc/admin build && \
    find apps/app/dist apps/admin/dist -name '*.map' -delete && \
    node scripts/check-dist.mjs && \
    node scripts/scan-bundles.mjs

# Deployable web image (staging/production): Caddy + the built apps baked in, pulled by digest.
FROM base AS runtime
COPY --from=web-build --chown=0:0 /repo/apps/app/dist /srv/app
COPY --from=web-build --chown=0:0 /repo/apps/admin/dist /srv/admin
