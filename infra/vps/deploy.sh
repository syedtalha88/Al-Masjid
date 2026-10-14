#!/usr/bin/env bash
# Pull deploy for one environment (DECISIONS #27, #55, #56, #59; PHASE_00 T0.14). Run as root by the mc-deploy@<env>
# systemd timer every minute (env files are root 600 — 04 §12.2); never by CI (CI has no access to the server).
#   deploy.sh <staging|production>                 fetch, verify, deploy if new
#   deploy.sh <staging|production> --check-only    fetch + verify + print the plan, change nothing
#   deploy.sh <staging|production> --rollback      redeploy the previous verified release from the local history
#                                                  (each run goes further back; releases rolled back from are
#                                                  skipped until a newer one is published — to go forward again
#                                                  sooner: rm <state>/rolled-back)
# Installed as a root-owned copy in /usr/local/lib/masjid-connect by `provision.sh host <sha>` — it never runs from a
# release checkout (review S-H1). Each environment has its own checkout (/srv/masjid-connect/<env>) that only its own
# signed releases move; the compose file from that checkout must pass the hardening policy below before it runs.
# A staging manifest without a web image (staging build variables not set yet) keeps the running web image.
# Verification, deploy, rolling restart and rollback logic are tested with stubbed git/docker
# (infra/vps/test/deploy-verify.test.sh, CI); docker itself runs first on the server.
set -euo pipefail

# Everything runs inside main(): bash parses the whole function before running it.
main() {
  ENVIRONMENT=${1:-}
  MODE=${2:-deploy}
  case "$ENVIRONMENT" in staging | production) ;; *) echo "usage: deploy.sh <staging|production> [--check-only|--rollback]" >&2; exit 2 ;; esac
  case "$MODE" in deploy | --check-only | --rollback) ;; *) echo "unknown option: $MODE" >&2; exit 2 ;; esac

  REPO=${MC_RELEASE_REPO:-syedtalha88/Al-Masjid}
  BASE_URL=${MC_RELEASE_BASE_URL:-https://github.com/$REPO/releases/download/$ENVIRONMENT-current}
  CONFIG_DIR=${MC_CONFIG_DIR:-/etc/masjid-connect/$ENVIRONMENT}   # allowed_signers, env files, certs (root)
  STATE_DIR=${MC_STATE_DIR:-/var/lib/masjid-connect/$ENVIRONMENT} # releases/, releases.log, rolled-back (root)
  REPO_DIR=${MC_REPO_DIR:-/srv/masjid-connect/$ENVIRONMENT}       # this environment's own checkout
  LIB_DIR=${MC_LIB_DIR:-/usr/local/lib/masjid-connect}            # host scripts (log-archive.sh)
  LOCK_FILE=${MC_LOCK_FILE:-/run/lock/masjid-connect-deploy.lock}
  COMPOSE_FILE=$REPO_DIR/infra/compose/docker-compose.vps.yml
  NAMESPACE=masjid-connect-release
  SIGNER=masjid-connect-$ENVIRONMENT
  REGISTRY_RE='^ghcr\.io/syedtalha88/al-masjid-(server|web)@sha256:[0-9a-f]{64}$'

  # One deploy at a time on this host: both environments, the timer and manual rollbacks (review S-H1).
  mkdir -p "$(dirname "$LOCK_FILE")"
  exec 9>"$LOCK_FILE"
  flock -w "${MC_LOCK_WAIT:-900}" 9 || die "another deploy is still running"

  mkdir -p "$STATE_DIR/releases"
  work=$(mktemp -d)
  trap 'rm -rf "$work"' EXIT

  if [ "$MODE" = --rollback ]; then
    local current previous
    current=$(current_release)
    [ -n "$current" ] || die "nothing deployed yet"
    # Remember every release we leave: the timer must not redeploy it, and the next rollback goes further back.
    printf '%s\n' "$current" >>"$STATE_DIR/rolled-back"
    # The newest deployed release we have not rolled back from.
    previous=$({ awk '{print $2}' "$STATE_DIR/releases.log" 2>/dev/null || true; } |
      { grep -vxF -f "$STATE_DIR/rolled-back" || true; } | tail -n 1)
    [ -n "$previous" ] || die "no previous release to roll back to"
    cp "$STATE_DIR/releases/$previous.json" "$work/manifest.json"
    cp "$STATE_DIR/releases/$previous.json.sig" "$work/manifest.json.sig"
    log "rolling back to $previous"
  else
    curl -fsSL --max-time 20 -o "$work/manifest.json" "$BASE_URL/release-manifest.json" || die "cannot fetch manifest"
    curl -fsSL --max-time 20 -o "$work/manifest.json.sig" "$BASE_URL/release-manifest.json.sig" || die "cannot fetch signature"
  fi

  verify "$work/manifest.json" "$work/manifest.json.sig"
  local release server_image web_image
  release=$(jq -r .release "$work/manifest.json")
  server_image=$(jq -r .images.server "$work/manifest.json")
  web_image=$(jq -r '.images.web // empty' "$work/manifest.json")

  if [ "$MODE" = deploy ] && [ "$release" = "$(current_release)" ]; then
    exit 0 # nothing new (the timer runs every minute — stay quiet)
  fi
  if [ "$MODE" = deploy ] && grep -qxF "$release" "$STATE_DIR/rolled-back" 2>/dev/null; then
    exit 0 # rolled back from this release; wait for a newer one
  fi
  if [ "$MODE" != --rollback ]; then
    # Replay protection (review S-M1): a validly signed but OLDER manifest (re-uploaded by anyone with write access to
    # the repository) must never downgrade the environment. Rollbacks use the local history instead.
    local newest created
    newest=$(newest_deployed_created)
    created=$(jq -r "$EPOCH" "$work/manifest.json")
    if [ -n "$newest" ] && [ "$created" -le "$newest" ]; then
      die "manifest $release is not newer than the newest deployed release — refusing (replayed or stale manifest)"
    fi
  fi
  if [ "$MODE" = --check-only ]; then
    log "verified release $release — would deploy server=$server_image web=${web_image:-<unchanged>}"
    exit 0
  fi
  if [ -z "$web_image" ]; then # staging only (verify() refuses this for production)
    # The web image this release ran with before (rollback), else the one running now.
    local candidate
    for candidate in "$release" "$(current_release)"; do
      [ -n "$web_image" ] || web_image=$(jq -r '.images.web // empty' "$STATE_DIR/releases/$candidate.deployed.json" 2>/dev/null || true)
    done
    [ -n "$web_image" ] || die "manifest has no web image and none is running yet (staging build variables — DEPLOY.md)"
  fi

  log "deploying $release"
  # Compose files and Caddy/Redis config come from this environment's checkout at the signed commit (git checks every
  # object against the SHA). Nothing from this checkout runs on the host itself.
  [ -d "$REPO_DIR/.git" ] || git clone --quiet "https://github.com/$REPO.git" "$REPO_DIR"
  git -C "$REPO_DIR" fetch --quiet --depth 1 origin "$release"
  git -C "$REPO_DIR" checkout --quiet --detach "$release"
  export MC_ENV=$ENVIRONMENT MC_CONFIG_DIR=$CONFIG_DIR MC_INFRA_DIR=$REPO_DIR/infra SERVER_IMAGE=$server_image WEB_IMAGE=$web_image
  compose_policy || die "compose file of $release breaks the hardening policy — refusing"
  compose pull --quiet
  # Migrations arrive in Phase 1: `compose run --rm migrate` here, production only after the owner's approval.

  # Rolling replacement (PHASE_00 T0.14, 01 §8): stateless services get their new containers next to the old ones,
  # healthy first, then the old ones drain and go. Logs of every container are archived before it is removed (S-H3).
  local singles
  mapfile -t singles < <(compose ps -q redis worker 2>/dev/null || true)
  archive_logs "${singles[@]}"
  compose up -d --no-deps --wait --wait-timeout 120 redis || die "redis did not become healthy"
  rolling api-public 2 || die "api-public: new containers unhealthy — old ones kept running"
  rolling api-admin 2 || die "api-admin: new containers unhealthy — old ones kept running"
  compose up -d --no-deps --wait --wait-timeout 120 worker || die "worker did not become healthy — run: deploy.sh $ENVIRONMENT --rollback"
  rolling web 1 || die "web: new container unhealthy — old one kept running"
  compose up -d --remove-orphans --wait --wait-timeout 120 || die "services did not converge — run: deploy.sh $ENVIRONMENT --rollback"

  # Smoke checks inside the project (the public port only accepts Cloudflare's client certificate).
  compose exec -T api-public /nodejs/bin/node dist/healthcheck.mjs api-public || die "api-public smoke check failed"
  compose exec -T api-admin /nodejs/bin/node dist/healthcheck.mjs api-admin || die "api-admin smoke check failed"

  # Recorded with the web image actually deployed, so a later server-only release or a rollback can reuse it.
  jq --arg web "$web_image" '.images.web = $web' "$work/manifest.json" >"$STATE_DIR/releases/$release.deployed.json"
  cp "$work/manifest.json" "$STATE_DIR/releases/$release.json"
  cp "$work/manifest.json.sig" "$STATE_DIR/releases/$release.json.sig"
  printf '%s %s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$release" "$(sha256sum "$work/manifest.json" | cut -d' ' -f1)" >>"$STATE_DIR/releases.log"
  if [ "$MODE" = deploy ]; then rm -f "$STATE_DIR/rolled-back"; fi
  log "deployed $release"
}

# ISO-8601 `created` → epoch seconds (fractions dropped).
EPOCH='.created | sub("\\.[0-9]+Z$"; "Z") | fromdateiso8601'

log() { printf '%s deploy[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$ENVIRONMENT" "$*"; }
die() { log "ERROR: $*"; exit 1; }
current_release() { tail -n 1 "$STATE_DIR/releases.log" 2>/dev/null | awk '{print $2}'; }
compose() { docker compose -p "mc-$ENVIRONMENT" -f "$COMPOSE_FILE" "$@"; }

newest_deployed_created() {
  local files=("$STATE_DIR"/releases/*.deployed.json)
  [ -e "${files[0]}" ] || return 0
  jq -rs "[.[] | $EPOCH] | max" "${files[@]}"
}

# Archives the logs of the given containers (no-op without ids). Production refuses to lose logs (CERT-In); staging
# only warns — e.g. before the owner has installed the archive key (PROGRESS O3).
archive_logs() {
  [ $# -gt 0 ] || return 0
  "$LIB_DIR/log-archive.sh" --container "$@" && return 0
  [ "$ENVIRONMENT" = production ] && die "log archive failed — refusing to remove containers (CERT-In)"
  log "WARNING: log archive failed for $* (archive key missing? PROGRESS O3)"
}

# Waits until every given container is healthy (or running, without a healthcheck); fails on unhealthy/exited/timeout.
wait_healthy() {
  local id status deadline=$((SECONDS + 180))
  for id in "$@"; do
    while :; do
      status=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id" 2>/dev/null || echo missing)
      case "$status" in
        healthy | running) break ;;
        unhealthy | exited | dead | missing) return 1 ;;
      esac
      [ "$SECONDS" -lt "$deadline" ] || return 1
      sleep 2
    done
  done
}

# Rolling replacement of one stateless service: start <replicas> new containers next to the old ones (compose keeps
# the old ones with --no-recreate and creates the new ones from the new config), wait until they are healthy, then
# stop (graceful drain — T0.4), archive and remove the old ones. On failure the new containers go, the old ones stay.
rolling() { # <service> <replicas>
  local svc=$1 replicas=$2 old new
  mapfile -t old < <(compose ps -q "$svc" || true)
  compose up -d --no-deps --no-recreate --scale "$svc=$((replicas + ${#old[@]}))" "$svc" || return 1
  mapfile -t new < <(compose ps -q "$svc" | { grep -vxF -f <(printf '%s\n' "${old[@]}") || true; })
  if [ "${#new[@]}" -eq 0 ] || ! wait_healthy "${new[@]}"; then
    [ "${#new[@]}" -eq 0 ] || docker rm -f "${new[@]}" >/dev/null 2>&1 || true
    return 1
  fi
  if [ "${#old[@]}" -gt 0 ]; then
    docker stop -t 30 "${old[@]}" >/dev/null
    archive_logs "${old[@]}"
    docker rm "${old[@]}" >/dev/null
  fi
}

# Hardening policy for the release's compose file (review S-H1): a compose file can otherwise ask root Docker for
# anything. Every service must keep the 04 §12.2 settings, publish no port, and bind-mount only from this
# environment's config directory or its own checkout's infra/ directory.
compose_policy() {
  local problems
  problems=$(compose config --format json | jq -r --arg cfg "$CONFIG_DIR/" --arg infra "$REPO_DIR/infra/" '
    .services | to_entries[] | .key as $n | .value |
    (if .privileged == true then "\($n): privileged" else empty end),
    (if ((.cap_add // []) | length) > 0 then "\($n): cap_add" else empty end),
    (if ((.cap_drop // []) | index("ALL")) == null then "\($n): cap_drop ALL missing" else empty end),
    (if .read_only != true then "\($n): read_only missing" else empty end),
    (if ((.security_opt // []) | index("no-new-privileges:true")) == null then "\($n): no-new-privileges missing" else empty end),
    (if ((.ports // []) | length) > 0 then "\($n): publishes ports" else empty end),
    (if ((.devices // []) | length) > 0 then "\($n): devices" else empty end),
    (if (.network_mode // .pid // .ipc // .userns_mode // .cgroup_parent // .volumes_from) != null
      then "\($n): host/shared namespace setting" else empty end),
    ((.volumes // [])[] | select(.type != "volume")
      | select(.type != "bind" or (.source | contains("/../")) or
          ((.source | startswith($cfg)) or (.source | startswith($infra)) | not))
      | "\($n): mount \(.type) \(.source)")')
  [ -z "$problems" ] && return 0
  log "compose policy violations:"
  printf '  %s\n' "$problems" >&2
  return 1
}

# Verifies $1 (manifest) against $2 (signature) and the environment's allowed signer; prints nothing on success.
verify() {
  ssh-keygen -Y verify -f "$CONFIG_DIR/allowed_signers" -I "$SIGNER" -n "$NAMESPACE" -s "$2" <"$1" >/dev/null 2>&1 ||
    die "signature check failed — refusing to deploy"
  [ "$(jq -r .environment "$1")" = "$ENVIRONMENT" ] || die "manifest is for another environment"
  jq -re '.release | test("^[0-9a-f]{40}$")' "$1" >/dev/null || die "manifest release is not a commit SHA"
  jq -re '.created | test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]+)?Z$")' "$1" >/dev/null ||
    die "manifest has no valid creation time"
  jq -re --arg re "$REGISTRY_RE" '.images.server | test($re)' "$1" >/dev/null || die "server image is not ours by digest"
  if jq -e '.images.web' "$1" >/dev/null; then
    jq -re --arg re "$REGISTRY_RE" '.images.web | test($re)' "$1" >/dev/null || die "web image is not ours by digest"
  elif [ "$ENVIRONMENT" = production ]; then
    die "production manifest has no web image"
  fi
}

main "$@"; exit
