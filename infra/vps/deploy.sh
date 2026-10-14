#!/usr/bin/env bash
# Pull deploy for one environment (DECISIONS #27, #55, #56; PHASE_00 T0.14). Run as root by the mc-deploy@<env>
# systemd timer every minute (env files are root 600 — 04 §12.2); never by CI (CI has no access to the server).
#   deploy.sh <staging|production>                 fetch, verify, deploy if new
#   deploy.sh <staging|production> --check-only    fetch + verify + print the plan, change nothing
#   deploy.sh <staging|production> --rollback      redeploy the previous verified release from the local history
# DRAFT 14 Oct 2026 — reviewed and installed with the owner in T0.14. Verification is tested locally
# (scripts/test-deploy-verify.sh); the docker part runs for the first time on the server.
set -euo pipefail

ENVIRONMENT=${1:-}
MODE=${2:-deploy}
case "$ENVIRONMENT" in staging | production) ;; *) echo "usage: deploy.sh <staging|production> [--check-only|--rollback]" >&2; exit 2 ;; esac
case "$MODE" in deploy | --check-only | --rollback) ;; *) echo "unknown option: $MODE" >&2; exit 2 ;; esac

REPO=${MC_RELEASE_REPO:-syedtalha88/Al-Masjid}
BASE_URL=${MC_RELEASE_BASE_URL:-https://github.com/$REPO/releases/download/$ENVIRONMENT-current}
CONFIG_DIR=${MC_CONFIG_DIR:-/etc/masjid-connect/$ENVIRONMENT}   # allowed_signers, env files, certs (root, 600/644)
STATE_DIR=${MC_STATE_DIR:-/var/lib/masjid-connect/$ENVIRONMENT} # releases/, releases.log (deploy user)
REPO_DIR=${MC_REPO_DIR:-/opt/masjid-connect}
COMPOSE_FILE=${MC_COMPOSE_FILE:-$REPO_DIR/infra/compose/docker-compose.vps.yml}
NAMESPACE=masjid-connect-release
SIGNER=masjid-connect-$ENVIRONMENT
REGISTRY_RE='^ghcr\.io/syedtalha88/al-masjid-(server|web)@sha256:[0-9a-f]{64}$'

log() { printf '%s deploy[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$ENVIRONMENT" "$*"; }
die() { log "ERROR: $*"; exit 1; }

mkdir -p "$STATE_DIR/releases"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# Verifies $1 (manifest) against $2 (signature) and the environment's allowed signer; prints nothing on success.
verify() {
  ssh-keygen -Y verify -f "$CONFIG_DIR/allowed_signers" -I "$SIGNER" -n "$NAMESPACE" -s "$2" <"$1" >/dev/null 2>&1 ||
    die "signature check failed — refusing to deploy"
  [ "$(jq -r .environment "$1")" = "$ENVIRONMENT" ] || die "manifest is for another environment"
  jq -re '.release | test("^[0-9a-f]{40}$")' "$1" >/dev/null || die "manifest release is not a commit SHA"
  jq -re --arg re "$REGISTRY_RE" '.images.server | test($re)' "$1" >/dev/null || die "server image is not ours by digest"
  if jq -e '.images.web' "$1" >/dev/null; then
    jq -re --arg re "$REGISTRY_RE" '.images.web | test($re)' "$1" >/dev/null || die "web image is not ours by digest"
  elif [ "$ENVIRONMENT" = production ]; then
    die "production manifest has no web image"
  fi
}

current_release() { tail -n 1 "$STATE_DIR/releases.log" 2>/dev/null | awk '{print $2}'; }

if [ "$MODE" = --rollback ]; then
  previous=$(tail -n 2 "$STATE_DIR/releases.log" 2>/dev/null | head -n 1 | awk '{print $2}')
  [ -n "$previous" ] && [ "$previous" != "$(current_release)" ] || die "no previous release to roll back to"
  # Skip the release we are leaving until a newer one is published (else the timer would redeploy it at once).
  current_release >"$STATE_DIR/skip-release"
  cp "$STATE_DIR/releases/$previous.json" "$work/manifest.json"
  cp "$STATE_DIR/releases/$previous.json.sig" "$work/manifest.json.sig"
  log "rolling back to $previous"
else
  curl -fsSL --max-time 20 -o "$work/manifest.json" "$BASE_URL/release-manifest.json" || die "cannot fetch manifest"
  curl -fsSL --max-time 20 -o "$work/manifest.json.sig" "$BASE_URL/release-manifest.json.sig" || die "cannot fetch signature"
fi

verify "$work/manifest.json" "$work/manifest.json.sig"
release=$(jq -r .release "$work/manifest.json")
server_image=$(jq -r .images.server "$work/manifest.json")
web_image=$(jq -r '.images.web // empty' "$work/manifest.json")

if [ "$MODE" = deploy ] && [ "$release" = "$(current_release)" ]; then
  exit 0 # nothing new (the timer runs every minute — stay quiet)
fi
if [ "$MODE" = deploy ] && [ "$release" = "$(cat "$STATE_DIR/skip-release" 2>/dev/null)" ]; then
  exit 0 # rolled back from this release; wait for a newer one
fi
if [ "$MODE" = --check-only ]; then
  log "verified release $release — would deploy server=$server_image web=${web_image:-<unchanged>}"
  exit 0
fi

log "deploying $release"
# Compose files, Caddy/Redis config and these scripts come from the same commit as the images (the release SHA is
# signed; git checks every object against it).
git -C "$REPO_DIR" fetch --quiet --depth 1 origin "$release"
git -C "$REPO_DIR" checkout --quiet --detach "$release"
export MC_ENV=$ENVIRONMENT SERVER_IMAGE=$server_image
[ -n "$web_image" ] && export WEB_IMAGE=$web_image
compose() { docker compose -p "mc-$ENVIRONMENT" -f "$COMPOSE_FILE" "$@"; }
compose pull --quiet
# Migrations arrive in Phase 1: `compose run --rm migrate` here, production only after the owner's approval.
compose up -d --remove-orphans --wait --wait-timeout 180 || die "services did not become healthy — run: deploy.sh $ENVIRONMENT --rollback"

# Smoke checks inside the project (the public port only accepts Cloudflare's client certificate).
compose exec -T api-public /nodejs/bin/node dist/healthcheck.mjs api-public || die "api-public smoke check failed"
compose exec -T api-admin /nodejs/bin/node dist/healthcheck.mjs api-admin || die "api-admin smoke check failed"

cp "$work/manifest.json" "$STATE_DIR/releases/$release.json"
cp "$work/manifest.json.sig" "$STATE_DIR/releases/$release.json.sig"
printf '%s %s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$release" "$(sha256sum "$work/manifest.json" | cut -d' ' -f1)" >>"$STATE_DIR/releases.log"
[ "$MODE" = deploy ] && rm -f "$STATE_DIR/skip-release"
log "deployed $release"
