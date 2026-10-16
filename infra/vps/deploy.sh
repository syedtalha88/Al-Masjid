#!/usr/bin/env bash
# Pull deploy for one environment (DECISIONS #27, #55, #56, #59; PHASE_00 T0.14). Run as root by the mc-deploy@<env>
# systemd timer every minute (env files are root 600 — 04 §12.2); never by CI (CI has no access to the server).
#   deploy.sh <staging|production>                 fetch, verify, deploy if new
#   deploy.sh <staging|production> --check-only    fetch + verify + print the plan, change nothing
#   deploy.sh <staging|production> --verify-roles  READ-ONLY: each process checks its own MongoDB privileges against
#                                                  02 §4.3 (connectionStatus) inside its container (PHASE_01 T1.1)
#   deploy.sh <staging|production> --restart       rolling re-deploy of the current release (after an env file
#                                                  or certificate change — containers read them at creation)
#   deploy.sh <staging|production> --rollback      redeploy the previous verified release from the local history
#                                                  (each run goes further back; releases rolled back from are
#                                                  skipped until a newer one is published — to go forward again
#                                                  sooner: rm <state>/rolled-back)
# Installed as a root-owned copy in /usr/local/lib/masjid-connect by `provision.sh host <sha>` — it never runs from a
# release checkout (review S-H1). The compose file and redis.conf are part of that reviewed host layer too (DECISIONS
# #61, review H1 of 16 Oct 2026): a release supplies only signed image digests, never configuration that root Docker
# runs. Its manifest names the host-layer files it was built for; a mismatch stops the deploy with the
# `provision.sh host <sha>` to run. The hardening policy below still checks the rendered compose file.
# A staging manifest without a web image (staging build variables not set yet) keeps the running web image.
# Verification, deploy, rolling restart and rollback logic are tested with stubbed git/docker
# (infra/vps/test/deploy-verify.test.sh, CI); docker itself runs first on the server.
set -euo pipefail

# Everything runs inside main(): bash parses the whole function before running it.
main() {
  ENVIRONMENT=${1:-}
  MODE=${2:-deploy}
  case "$ENVIRONMENT" in staging | production) ;; *) echo "usage: deploy.sh <staging|production> [--check-only|--restart|--rollback|--verify-roles]" >&2; exit 2 ;; esac
  case "$MODE" in deploy | --check-only | --restart | --rollback | --verify-roles) ;; *) echo "unknown option: $MODE" >&2; exit 2 ;; esac

  REPO=${MC_RELEASE_REPO:-syedtalha88/Al-Masjid}
  BASE_URL=${MC_RELEASE_BASE_URL:-https://github.com/$REPO/releases/download/$ENVIRONMENT-current}
  CONFIG_DIR=${MC_CONFIG_DIR:-/etc/masjid-connect/$ENVIRONMENT}   # allowed_signers, env files, certs (root)
  STATE_DIR=${MC_STATE_DIR:-/var/lib/masjid-connect/$ENVIRONMENT} # releases/, releases.log, rolled-back (root)
  LIB_DIR=${MC_LIB_DIR:-/usr/local/lib/masjid-connect}            # host layer: scripts, compose file, redis.conf
  COMPOSE_DIR=$LIB_DIR/compose
  LOCK_FILE=${MC_LOCK_FILE:-/run/lock/masjid-connect-deploy.lock}
  COMPOSE_FILE=$COMPOSE_DIR/docker-compose.vps.yml
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
  elif [ "$MODE" = --restart ] || [ "$MODE" = --verify-roles ]; then
    local current
    current=$(current_release)
    [ -n "$current" ] || die "nothing deployed yet"
    cp "$STATE_DIR/releases/$current.json" "$work/manifest.json"
    cp "$STATE_DIR/releases/$current.json.sig" "$work/manifest.json.sig"
    if [ "$MODE" = --restart ]; then log "restarting $current (rolling) to pick up changed env files"; fi
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
  if [ "$MODE" = deploy ] || [ "$MODE" = --check-only ]; then
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

  host_layer_matches "$work/manifest.json" ||
    die "release $release needs the host layer from its own commit — run: sudo bash provision.sh host $release"
  log "deploying $release"
  export MC_ENV=$ENVIRONMENT MC_CONFIG_DIR=$CONFIG_DIR MC_COMPOSE_DIR=$COMPOSE_DIR SERVER_IMAGE=$server_image WEB_IMAGE=$web_image
  compose_policy || die "the installed compose file breaks the hardening policy — refusing"
  if [ "$MODE" = --verify-roles ]; then
    # Each one-off container holds only its own credential; the check reads (connectionStatus), never writes.
    local svc failed=0
    for svc in api-public api-admin worker migrate; do
      [ "$svc" != migrate ] || [ -f "$CONFIG_DIR/migrate.env" ] || { log "migrate: no migrate.env — skipped"; continue; }
      compose --profile migrate run --rm --no-deps -T "$svc" dist/verify-roles.mjs || failed=1
    done
    [ "$failed" -eq 0 ] || die "database privileges differ from 02 §4.3 (see FAIL lines above)"
    log "verify-roles: every process has exactly its 02 §4.3 privileges"
    exit 0
  fi
  compose pull --quiet
  # Migrations first (PHASE_01 T1.2): a failure stops here, before any container changes. Production releases are
  # approved by the owner in GitHub (deploy-prod) before their manifest exists, which covers their migrations.
  if [ -f "$CONFIG_DIR/migrate.env" ]; then
    log "migrating $release"
    compose --profile migrate run --rm --no-deps migrate || die "migrations failed — the running release is untouched"
  elif [ "$ENVIRONMENT" = production ]; then
    die "no migrate.env — run atlas-users.sh production before the first Phase 1 release"
  else
    log "WARNING: no $CONFIG_DIR/migrate.env (Atlas users not set up yet — atlas-users.sh) — migrations skipped"
  fi

  # Rolling replacement (PHASE_00 T0.14, 01 §8): stateless services get their new containers next to the old ones,
  # healthy first, then the old ones drain and go. Logs of every container are archived before it is removed (S-H3).
  replace_single redis || die "redis did not become healthy"
  rolling api-public 2 || die "api-public: new containers unhealthy — old ones kept running"
  rolling api-admin 2 || die "api-admin: new containers unhealthy — old ones kept running"
  replace_single worker || die "worker did not become healthy — run: deploy.sh $ENVIRONMENT --rollback"
  rolling web 1 || die "web: new container unhealthy — old one kept running"
  archive_orphans
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

# Single-container services (redis, worker): stop the old container, archive its logs, then let compose start the new
# one — stop first, so no log line falls between the archive and the replacement (re-review L2).
replace_single() { # <service>
  local svc=$1 old
  mapfile -t old < <(compose ps -q "$svc" 2>/dev/null || true)
  if [ "${#old[@]}" -gt 0 ]; then
    docker stop -t 30 "${old[@]}" >/dev/null
    archive_logs "${old[@]}"
  fi
  compose up -d --no-deps --wait --wait-timeout 120 "$svc"
}

# Containers of this project whose service is no longer in the compose file: `up --remove-orphans` deletes them, so
# their logs are archived first (re-review L2).
archive_orphans() {
  local services orphans
  services=" $(compose config --services 2>/dev/null | tr '\n' ' ') "
  mapfile -t orphans < <(docker ps -a --filter "label=com.docker.compose.project=mc-$ENVIRONMENT" \
    --format '{{.ID}} {{.Label "com.docker.compose.service"}}' 2>/dev/null |
    awk -v keep="$services" 'NF == 2 && index(keep, " " $2 " ") == 0 { print $1 }')
  archive_logs "${orphans[@]}"
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
    if [ "${#new[@]}" -gt 0 ]; then
      # The reason it failed is in its logs: show them in the journal and archive them before removing (F33).
      local id
      for id in "${new[@]}"; do
        log "$svc: new container ${id:0:12} failed — its last log lines:"
        docker logs --tail 30 "$id" 2>&1 | sed 's/^/    /' || true
      done
      archive_logs "${new[@]}"
      docker rm -f "${new[@]}" >/dev/null 2>&1 || true
    fi
    return 1
  fi
  if [ "${#old[@]}" -gt 0 ]; then
    docker stop -t 30 "${old[@]}" >/dev/null
    archive_logs "${old[@]}"
    docker rm "${old[@]}" >/dev/null
  fi
}

# The manifest's hostLayer hashes (written by CI from the release commit) must match the installed compose file and
# redis.conf, so images never run with configuration from another commit. Manifests from before 16 Oct 2026 have
# no hashes: allowed with a warning (rollback to them stays possible).
host_layer_matches() {
  local want_compose want_redis
  want_compose=$(jq -r '.hostLayer.compose // empty' "$1")
  want_redis=$(jq -r '.hostLayer.redis // empty' "$1")
  if [ -z "$want_compose" ] || [ -z "$want_redis" ]; then
    log "WARNING: manifest names no host layer (older release) — using the installed compose file"
    return 0
  fi
  [ "$(sha256sum <"$COMPOSE_FILE" | cut -d' ' -f1)" = "$want_compose" ] &&
    [ "$(sha256sum <"$COMPOSE_DIR/redis.conf" | cut -d' ' -f1)" = "$want_redis" ]
}

# Hardening policy (review S-H1, H1): defence in depth on the rendered compose file, although it now comes only from the
# reviewed host layer. Every service keeps the 04 §12.2 settings, runs one of the release's images or the pinned
# Redis, publishes no port, builds nothing, mounts only this environment's config directory or the host layer's
# compose directory, and joins no external network except this environment's edge network.
compose_policy() {
  local problems
  # Rendered with every profile, so the one-off migrate service is checked too.
  problems=$(compose --profile migrate config --format json | jq -r --arg cfg "$CONFIG_DIR/" --arg cmp "$COMPOSE_DIR/" \
    --arg server "$SERVER_IMAGE" --arg web "$WEB_IMAGE" --arg edge "mc-edge-$ENVIRONMENT" '
    (if ((.secrets // {}) | length) > 0 or ((.configs // {}) | length) > 0 then "secrets/configs not allowed" else empty end),
    ((.volumes // {}) | to_entries[] | select(.value.driver != null or .value.driver_opts != null)
      | "volume \(.key): driver options"),
    ((.networks // {}) | to_entries[] | select(.value.external == true and .value.name != $edge)
      | "network \(.key): external \(.value.name)"),
    (.services | to_entries[] | .key as $n | .value |
    (if (.image == $server or .image == $web or (.image // "" | test("^redis:[0-9.]+-alpine@sha256:[0-9a-f]{64}$"))) | not
      then "\($n): image \(.image)" else empty end),
    (if .build != null then "\($n): build" else empty end),
    (if (.security_opt // []) != ["no-new-privileges:true"] then "\($n): security_opt must be exactly no-new-privileges" else empty end),
    (if (.user // "") | test("^(root|0)(:|$)") then "\($n): runs as root" else empty end),
    (if (.uts // .cgroup) != null then "\($n): host uts/cgroup" else empty end),
    (if ((.sysctls // {}) | length) > 0 then "\($n): sysctls" else empty end),
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
          ((.source | startswith($cfg)) or (.source | startswith($cmp)) | not))
      | "\($n): mount \(.type) \(.source)"))')
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
