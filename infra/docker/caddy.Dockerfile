# syntax=docker/dockerfile:1
# Caddy image for both origins (static SPAs + reverse proxy). Runs as a non-root user on ports 8443/8080
# (04 §12.2); the host maps 443 → 8443. Build context = repository root.
#   docker build -f infra/docker/caddy.Dockerfile --target base .      (local stack: dist mounted)
#   docker build -f infra/docker/caddy.Dockerfile --target runtime .   (staging/production: dist baked in — T0.14)

ARG CADDY_IMAGE=caddy:2.11.7-alpine@sha256:d8542f48d34a9cf4e4c11a478865229840e87e4c96ea3f439101f31a5d35f75f

FROM ${CADDY_IMAGE} AS base
# The official binary carries the cap_net_bind_service file capability (for ports < 1024). With
# no-new-privileges + cap_drop ALL a non-root user may not exec a binary with file capabilities, and we
# listen on high ports anyway — so strip it. libcap is a build-time tool removed in the same layer, so its
# version isn't pinned (Alpine drops old package versions, which would break the build); the base image
# itself is pinned by digest.
# hadolint ignore=DL3018
RUN apk add --no-cache --virtual .setcap libcap && \
    setcap -r /usr/bin/caddy && \
    apk del .setcap && \
    addgroup -S -g 1000 caddy && adduser -S -u 1000 -G caddy -H -s /sbin/nologin caddy
COPY infra/caddy/Caddyfile /etc/caddy/Caddyfile
USER 1000:1000
EXPOSE 8443 8080
