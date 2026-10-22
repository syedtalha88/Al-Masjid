#!/usr/bin/env bash
# Tests infra/vps/deploy.sh (DECISIONS #55, #56, #59, #61) without a server or Docker daemon: a throwaway signing key,
# manifests served by a local HTTP server; release verification via `--check-only`, then the deploy / rolling restart /
# rollback / replay / compose-policy / lock flow with git and docker replaced by stubs that record their calls.
# Run (from the repo root):
#   docker run --rm -v "$PWD/infra/vps:/vps:ro" ubuntu:24.04 bash /vps/test/deploy-verify.test.sh
# shellcheck disable=SC2016,SC2034 # check() conditions are single-quoted and eval'd after each run (they read got, old_api)
set -uo pipefail

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq >/dev/null && apt-get install -y -qq openssh-client jq curl python3 >/dev/null || exit 1

root=$(mktemp -d)
mkdir -p "$root/config" "$root/state" "$root/www/ok" "$root/www/bad"
ssh-keygen -q -t ed25519 -N '' -C test -f "$root/key"
ssh-keygen -q -t ed25519 -N '' -C other -f "$root/other-key"
printf 'masjid-connect-staging namespaces="masjid-connect-release" %s\n' "$(cat "$root/key.pub")" >"$root/config/allowed_signers"

digest() { printf 'sha256:%064d' "$1"; }
# HOST_LAYER (JSON, optional): the manifest's hostLayer hashes; unset = an older manifest without them.
manifest() { # <dir> <environment> <server image> [web image] [release] [created]
  local web=${4:-} release=${5:-0123456789abcdef0123456789abcdef01234567} created=${6:-2026-10-14T00:00:00.000Z}
  jq -n --arg env "$2" --arg server "$3" --arg web "$web" --arg release "$release" --arg created "$created" \
    --argjson host "${HOST_LAYER:-null}" \
    '{environment: $env, release: $release, created: $created,
      images: ({server: $server} + (if $web == "" then {} else {web: $web} end))}
     + (if $host == null then {} else {hostLayer: $host} end)' >"$1/release-manifest.json"
}
sign() { ssh-keygen -q -Y sign -f "$2" -n masjid-connect-release "$1/release-manifest.json"; } # writes .sig

(cd "$root/www" && python3 -m http.server 8999 >/dev/null 2>&1 &)
sleep 1

server="ghcr.io/syedtalha88/al-masjid-server@$(digest 1)"
web="ghcr.io/syedtalha88/al-masjid-web@$(digest 2)"
failures=0
expect() { # <label> <expected exit> <case dir> <environment>
  MC_RELEASE_BASE_URL="http://127.0.0.1:8999/$3" MC_CONFIG_DIR="$root/config" MC_STATE_DIR="$root/state" \
    MC_LOCK_FILE="$root/lock" bash /vps/deploy.sh "$4" --check-only >"$root/out" 2>&1
  local got=$?
  if [ "$got" -eq "$2" ]; then echo "PASS  $1"; else echo "FAIL  $1 (exit $got)"; sed 's/^/      /' "$root/out"; failures=$((failures + 1)); fi
}
case_dir() { rm -rf "$root/www/$1"; mkdir -p "$root/www/$1"; echo "$root/www/$1"; }

d=$(case_dir valid); manifest "$d" staging "$server" "$web"; sign "$d" "$root/key"
expect "valid signed staging manifest is accepted" 0 valid staging

d=$(case_dir server-only); manifest "$d" staging "$server"; sign "$d" "$root/key"
expect "staging manifest without a web image is accepted" 0 server-only staging

d=$(case_dir tampered); manifest "$d" staging "$server" "$web"; sign "$d" "$root/key"
jq '.images.server = "ghcr.io/syedtalha88/al-masjid-server@'"$(digest 9)"'"' "$d/release-manifest.json" >"$d/t" && mv "$d/t" "$d/release-manifest.json"
expect "manifest changed after signing is rejected" 1 tampered staging

d=$(case_dir other-key); manifest "$d" staging "$server" "$web"; sign "$d" "$root/other-key"
expect "manifest signed with another key is rejected" 1 other-key staging

d=$(case_dir unsigned); manifest "$d" staging "$server" "$web"
expect "manifest without a signature is rejected" 1 unsigned staging

d=$(case_dir wrong-env); manifest "$d" production "$server" "$web"; sign "$d" "$root/key"
expect "manifest for another environment is rejected" 1 wrong-env staging

d=$(case_dir foreign); manifest "$d" staging "docker.io/evil/server@$(digest 1)" "$web"; sign "$d" "$root/key"
expect "image outside our registry is rejected" 1 foreign staging

d=$(case_dir tag); manifest "$d" staging "ghcr.io/syedtalha88/al-masjid-server:latest" "$web"; sign "$d" "$root/key"
expect "image by tag instead of digest is rejected" 1 tag staging

d=$(case_dir no-time); manifest "$d" staging "$server" "$web" "" "yesterday"; sign "$d" "$root/key"
expect "manifest without a valid creation time is rejected" 1 no-time staging

expect "a missing manifest is an error" 1 nowhere staging

# --- Deploy flow: git and docker are stubs (no daemon, no repository) ------------------------------------------------
# The docker stub records every call, keeps a per-service list of fake container ids (so the rolling restart can be
# followed), prints a compose config for the hardening policy, and reports every container healthy. A deploy must never
# call git: the compose file comes from the host layer (DECISIONS #61), not from a release checkout.
stub=$root/stub
mkdir -p "$stub/lib/compose" "$root/stub-state"
printf 'services: {}\n' >"$stub/lib/compose/docker-compose.vps.yml"
printf 'aclfile /usr/local/etc/redis/users.acl\n' >"$stub/lib/compose/redis.conf"
sha() { sha256sum <"$1" | cut -d" " -f1; }
HOST_LAYER=$(jq -nc --arg c "$(sha "$stub/lib/compose/docker-compose.vps.yml")" --arg r "$(sha "$stub/lib/compose/redis.conf")" \
  '{compose: $c, redis: $r}')
cat >"$stub/docker" <<'STUB'
#!/bin/bash
echo "$(basename "$0") WEB_IMAGE=${WEB_IMAGE:-} $*" >>"$STUB_CALLS"
[ "$(basename "$0")" = docker ] || exit 0
args=" $* "
case "$args" in
  *" config --format json "*)
    jq --arg s "${SERVER_IMAGE:-}" --arg w "${WEB_IMAGE:-}" \
      '.services |= map_values(if .image == "@SERVER@" then .image = $s elif .image == "@WEB@" then .image = $w else . end)' \
      "$STUB_COMPOSE_JSON" ;;
  *" ps -q "*)
    for svc in "$@"; do if [ -f "$STUB_STATE/$svc" ]; then cat "$STUB_STATE/$svc"; fi; done ;;
  *" up "*" --scale "*)
    [ -z "${STUB_FAIL_UP:-}" ] || exit 1
    spec=$(sed -E 's/.* --scale ([^ ]+) .*/\1/' <<<"$args")
    svc=${spec%=*} n=${spec#*=}
    touch "$STUB_STATE/$svc"
    while [ "$(wc -l <"$STUB_STATE/$svc")" -lt "$n" ]; do echo "$svc-$RANDOM$RANDOM" >>"$STUB_STATE/$svc"; done ;;
  *" up "*) [ -z "${STUB_FAIL_UP:-}" ] ;;
  *" run --rm --no-deps migrate"*) [ -z "${STUB_FAIL_MIGRATE:-}" ] || exit 1 ;;
  *" dist/verify-roles.mjs"*) case "$args" in *" ${STUB_FAIL_VERIFY:-none} "*) exit 1 ;; esac ;;
  *" dist/bootstrap-super-admin.mjs"*) printf '%s\n' "$@" >"$STUB_STATE/bootstrap-args"; [ -z "${STUB_FAIL_BOOTSTRAP:-}" ] || exit 1 ;;
  *" inspect "*)
    # STUB_UNHEALTHY=<service>: that service's containers have exited (e.g. Caddy refusing a broken certificate).
    if [ -n "${STUB_UNHEALTHY:-}" ] && [[ "${*: -1}" == "$STUB_UNHEALTHY"-* ]]; then echo exited; else echo healthy; fi ;;
  " logs "*) echo "stub: loading certificates: tls: failed to find any PEM data" ;;
  " rm "* | " rm -f "*)
    for id in "$@"; do
      for f in "$STUB_STATE"/*; do grep -vxF -- "$id" "$f" >"$f.t"; mv "$f.t" "$f"; done
    done ;;
esac
exit 0
STUB
cp "$stub/docker" "$stub/git"
printf '#!/bin/sh\necho "log-archive $*" >>"$STUB_CALLS"\n' >"$stub/lib/log-archive.sh"
chmod +x "$stub/docker" "$stub/git" "$stub/lib/log-archive.sh"
export STUB_CALLS=$root/calls STUB_STATE=$root/stub-state
# Compose configs as `docker compose config --format json` prints them: hardened (passes) and with one bad service.
service() { # <image> <bind source or "">
  jq -n --arg image "$1" --arg src "$2" '{image: $image, read_only: true, cap_drop: ["ALL"],
    security_opt: ["no-new-privileges:true"],
    volumes: (if $src == "" then [] else [{type: "bind", source: $src, target: "/x", read_only: true}] end)}'
}
redis_image="redis:8.10.2-alpine@$(digest 7)"
jq -n --argjson web "$(service @WEB@ "$root/config/certs")" --argjson redis "$(service "$redis_image" "$stub/lib/compose/redis.conf")" \
  --argjson api "$(service @SERVER@ "")" \
  '{services: {web: $web, redis: $redis, "api-public": $api, "api-admin": $api, worker: $api},
    networks: {edge: {external: true, name: "mc-edge-staging"}}, volumes: {"redis-data": {}}}' >"$root/compose-ok.json"
jq '.services.worker.privileged = true' "$root/compose-ok.json" >"$root/compose-privileged.json"
jq '.services.worker.volumes = [{type: "bind", source: "/", target: "/host"}]' "$root/compose-ok.json" >"$root/compose-hostmount.json"
jq '.services.web.ports = [{target: 8443, published: "443"}]' "$root/compose-ok.json" >"$root/compose-ports.json"
# Review H1 (16 Oct 2026): bypasses of the earlier deny-list.
jq '.volumes.x = {driver: "local", driver_opts: {type: "none", o: "bind", device: "/"}}' "$root/compose-ok.json" >"$root/compose-namedvolume.json"
jq '.secrets = {s: {file: "/etc/masjid-connect/production/worker.env"}}' "$root/compose-ok.json" >"$root/compose-secrets.json"
jq '.networks.edge.name = "mc-edge-production"' "$root/compose-ok.json" >"$root/compose-prodedge.json"
jq '.services.worker.image = "docker.io/library/alpine:latest"' "$root/compose-ok.json" >"$root/compose-image.json"
jq '.services.worker.security_opt = ["no-new-privileges:true", "seccomp:unconfined"]' "$root/compose-ok.json" >"$root/compose-seccomp.json"
jq '.services.worker.build = {context: "."}' "$root/compose-ok.json" >"$root/compose-build.json"
jq '.services.worker.user = "0:0"' "$root/compose-ok.json" >"$root/compose-root.json"
jq '.services.worker.uts = "host"' "$root/compose-ok.json" >"$root/compose-uts.json"
export STUB_COMPOSE_JSON=$root/compose-ok.json
state=$root/flow-state
run() { # <case dir> [deploy.sh option]
  local dir=$1
  shift
  PATH="$stub:$PATH" MC_RELEASE_BASE_URL="http://127.0.0.1:8999/$dir" MC_CONFIG_DIR="$root/config" \
    MC_STATE_DIR="$state" MC_LIB_DIR="$stub/lib" MC_LOCK_FILE="$root/lock" \
    bash /vps/deploy.sh staging "$@" >"$root/out" 2>&1
}
check() { # <label> <condition>
  if eval "$2"; then echo "PASS  $1"; else echo "FAIL  $1"; sed 's/^/      /' "$root/out"; failures=$((failures + 1)); fi
}
rel() { printf '%040d' "$1"; }
running() { tail -n 1 "$state/releases.log" 2>/dev/null | awk '{print $2}'; }
deployed() { if [ -e "$state/releases.log" ]; then wc -l <"$state/releases.log"; else echo 0; fi; }
lines() { if [ -e "$1" ]; then wc -l <"$1"; else echo 0; fi; }
publish() { # <case> <release n> [web image] [created: seconds past midnight, default n]
  local d
  d=$(case_dir "$1")
  manifest "$d" staging "$server" "${3:-}" "$(rel "$2")" "$(printf '2026-10-14T00:00:%02d.123Z' "${4:-$2}")"
  sign "$d" "$root/key"
}
web2="ghcr.io/syedtalha88/al-masjid-web@$(digest 3)"
publish rel-1 1 "$web"
publish rel-2 2
publish rel-3 3 "$web2"
publish rel-4 4

run rel-2; got=$?
check "first release without a web image is refused (nothing to keep)" '[ "$got" -eq 1 ] && [ "$(deployed)" -eq 0 ]'
STUB_FAIL_UP=1 run rel-1; got=$?
check "unhealthy services: release not recorded" '[ "$got" -eq 1 ] && [ "$(deployed)" -eq 0 ]'
rm -f "$STUB_STATE"/*; : >"$STUB_CALLS"; run rel-1; got=$?
check "release 1 deploys: host-layer compose file, no git, images exported, 2 + 2 + 1 containers" \
  '[ "$got" -eq 0 ] && [ "$(running)" = "$(rel 1)" ] && ! grep -q "^git " "$STUB_CALLS" && grep -q -- "-f $stub/lib/compose/docker-compose.vps.yml" "$STUB_CALLS" && grep -q "WEB_IMAGE=$web compose .* up " "$STUB_CALLS" && [ "$(lines "$STUB_STATE/api-public")" -eq 2 ] && [ "$(lines "$STUB_STATE/web")" -eq 1 ]'
: >"$STUB_CALLS"; run rel-1; got=$?
check "same release again is a quiet no-op" '[ "$got" -eq 0 ] && [ "$(deployed)" -eq 1 ] && [ ! -s "$STUB_CALLS" ] && [ ! -s "$root/out" ]'
old_api=$(tr '\n' ' ' <"$STUB_STATE/api-public" | sed 's/ $//')
: >"$STUB_CALLS"; run rel-2; got=$?
check "server-only release keeps the running web image" \
  '[ "$got" -eq 0 ] && [ "$(running)" = "$(rel 2)" ] && grep -q "WEB_IMAGE=$web compose .* up " "$STUB_CALLS"'
check "rolling restart: 2 new api-public containers next to the 2 old ones, then the old ones stopped, archived, removed" \
  'grep -q -- "--scale api-public=4 api-public" "$STUB_CALLS" && [ "$(lines "$STUB_STATE/api-public")" -eq 2 ] && ! grep -qwF -e "${old_api%% *}" -e "${old_api##* }" "$STUB_STATE/api-public" && grep -q "stop -t 30 $old_api" "$STUB_CALLS" && grep -q "log-archive --container $old_api" "$STUB_CALLS"'
echo "worker-old1" >"$STUB_STATE/worker"
: >"$STUB_CALLS"; run rel-3; got=$?
check "release 3 deploys" '[ "$got" -eq 0 ] && [ "$(running)" = "$(rel 3)" ]'
order=$(grep -nE "stop -t 30 worker-old1|log-archive --container worker-old1|up -d --no-deps --wait --wait-timeout 120 worker" "$STUB_CALLS" | cut -d: -f1 | tr '\n' ' ')
check "single containers: worker stopped, then archived, then replaced — no unarchived gap (re-review L2)" \
  '[ "$(echo "$order" | wc -w)" -eq 3 ] && [ "$(echo "$order" | awk "{print (\$1 < \$2 && \$2 < \$3)}")" = 1 ]'
: >"$STUB_CALLS"; run rel-3 --rollback; got=$?
check "rollback returns to release 2 with the web image it ran with; 3 is skipped" \
  '[ "$got" -eq 0 ] && [ "$(running)" = "$(rel 2)" ] && grep -qx "$(rel 3)" "$state/rolled-back" && grep -q "WEB_IMAGE=$web compose .* up " "$STUB_CALLS"'
run rel-3; got=$?
check "timer does not redeploy the skipped release" '[ "$got" -eq 0 ] && [ "$(running)" = "$(rel 2)" ]'
run rel-3 --rollback; got=$?
check "second rollback goes further back (1), not forward to 3" '[ "$got" -eq 0 ] && [ "$(running)" = "$(rel 1)" ]'
run rel-3 --rollback; got=$?
check "nothing older: rollback refuses (never forward to 2)" '[ "$got" -eq 1 ] && [ "$(running)" = "$(rel 1)" ]'
run rel-3; got=$?
check "timer still waits for a newer release" '[ "$got" -eq 0 ] && [ "$(running)" = "$(rel 1)" ]'
: >"$STUB_CALLS"; run rel-4; got=$?
check "a newer release deploys (keeps web image of 1) and clears the skip" \
  '[ "$got" -eq 0 ] && [ "$(running)" = "$(rel 4)" ] && [ ! -e "$state/rolled-back" ] && grep -q "WEB_IMAGE=$web compose .* up " "$STUB_CALLS"'

publish rel-5 5 "$web" 2
run rel-5; got=$?
check "replay: a signed but OLDER manifest is refused (review S-M1)" \
  '[ "$got" -eq 1 ] && [ "$(running)" = "$(rel 4)" ] && grep -q "not newer" "$root/out"'
publish rel-6 6 "$web"
for bad in privileged hostmount ports namedvolume secrets prodedge image seccomp build root uts; do
  STUB_COMPOSE_JSON=$root/compose-$bad.json run rel-6; got=$?
  check "compose policy refuses a compose file with: $bad (review S-H1, H1)" \
    '[ "$got" -eq 1 ] && [ "$(running)" = "$(rel 4)" ] && grep -q "hardening policy" "$root/out"'
done
(flock "$root/lock" sleep 4 &)
sleep 1
MC_LOCK_WAIT=1 run rel-6; got=$?
check "a second deploy waits for the lock and gives up while it stays held" '[ "$got" -eq 1 ] && grep -q "another deploy" "$root/out"'
sleep 4
run rel-6; got=$?
check "with the lock free, the hardened release deploys" '[ "$got" -eq 0 ] && [ "$(running)" = "$(rel 6)" ]'

rm -f "$STUB_STATE"/api-public; : >"$STUB_CALLS"; run rel-6 --restart; got=$?
check "--restart re-deploys the current release (rolling) without a new manifest"   '[ "$got" -eq 0 ] && [ "$(running)" = "$(rel 6)" ] && grep -q -- "--scale api-public=2 api-public" "$STUB_CALLS" && grep -q "restarting $(rel 6)" "$root/out"'

publish rel-7 7 "$web"
old_web=$(cat "$STUB_STATE/web")
: >"$STUB_CALLS"; STUB_UNHEALTHY=web run rel-7; got=$?
new_web=$(grep -oE "log-archive --container web-[0-9]+" "$STUB_CALLS" | awk '{print $3}' | head -n 1)
check "failed new container: its last log lines reach the journal, its logs are archived, then it is removed (F33)"   '[ "$got" -eq 1 ] && [ "$(running)" = "$(rel 6)" ] && grep -q "failed to find any PEM data" "$root/out" && [ -n "$new_web" ] && [ "$new_web" != "$old_web" ] && grep -q "rm -f $new_web" "$STUB_CALLS" && [ "$(cat "$STUB_STATE/web")" = "$old_web" ]'

# A release built for other host-layer files (its compose file changed) must not run with the installed ones.
HOST_LAYER='{"compose":"0000000000000000000000000000000000000000000000000000000000000000","redis":"x"}' publish rel-8 8 "$web"
: >"$STUB_CALLS"; run rel-8; got=$?
check "release for another host layer: refused with the provision.sh host command to run (DECISIONS #61)" \
  '[ "$got" -eq 1 ] && [ "$(running)" = "$(rel 6)" ] && grep -q "provision.sh host $(rel 8)" "$root/out" && ! grep -q " up " "$STUB_CALLS"'
HOST_LAYER=null publish rel-9 9 "$web"
run rel-9; got=$?
check "older manifest without host-layer hashes: deploys with a warning" \
  '[ "$got" -eq 0 ] && [ "$(running)" = "$(rel 9)" ] && grep -q "names no host layer" "$root/out"'

# Migrations (PHASE_01 T1.2): run before any container changes; a failure keeps the running release.
publish rel-10 10 "$web"
: >"$STUB_CALLS"; run rel-10; got=$?
check "staging without migrate.env: migrations skipped with a warning, release deploys"   '[ "$got" -eq 0 ] && [ "$(running)" = "$(rel 10)" ] && grep -q "migrations skipped" "$root/out" && ! grep -q "run --rm --no-deps migrate" "$STUB_CALLS"'
touch "$root/config/migrate.env"
publish rel-11 11 "$web"
: >"$STUB_CALLS"; run rel-11; got=$?
check "with migrate.env: migrations run before the rolling update"   '[ "$got" -eq 0 ] && [ "$(running)" = "$(rel 11)" ] && [ "$(grep -n "run --rm --no-deps migrate" "$STUB_CALLS" | head -1 | cut -d: -f1)" -lt "$(grep -n -- "--scale api-public" "$STUB_CALLS" | head -1 | cut -d: -f1)" ]'
publish rel-12 12 "$web"
: >"$STUB_CALLS"; STUB_FAIL_MIGRATE=1 run rel-12; got=$?
check "failed migration: refused, nothing replaced, release not recorded"   '[ "$got" -eq 1 ] && [ "$(running)" = "$(rel 11)" ] && grep -q "migrations failed" "$root/out" && ! grep -q -- "--scale" "$STUB_CALLS"'
rm -f "$root/config/migrate.env"

# --verify-roles (PHASE_01 T1.1): read-only, runs the check in each process's container, never deploys or replaces.
: >"$STUB_CALLS"; run rel-11 --verify-roles; got=$?
check "--verify-roles runs the check in api-public, api-admin and worker (no migrate.env), changes nothing, logs no deploy (F36)"   '[ "$got" -eq 0 ] && ! grep -q "deploying" "$root/out" && [ "$(grep -c "dist/verify-roles.mjs" "$STUB_CALLS")" -eq 3 ] && ! grep -q -- "--scale" "$STUB_CALLS" && ! grep -q " pull " "$STUB_CALLS" && [ "$(running)" = "$(rel 11)" ]'
touch "$root/config/migrate.env"
: >"$STUB_CALLS"; STUB_FAIL_VERIFY=api-admin run rel-11 --verify-roles; got=$?
check "--verify-roles: a failing process fails the run; migrate is checked when it has credentials"   '[ "$got" -eq 1 ] && [ "$(grep -c "dist/verify-roles.mjs" "$STUB_CALLS")" -eq 4 ] && grep -q "privileges differ" "$root/out"'
rm -f "$root/config/migrate.env"

# --bootstrap-super-admin (PHASE_01 T1.9, DECISIONS #70 A): one-off api-admin container, arguments passed unchanged.
: >"$STUB_CALLS"; run rel-11 --bootstrap-super-admin --name 'Test Owner; rm -rf /' --locale ur; got=$?
check "--bootstrap-super-admin runs once in api-admin with the arguments verbatim, changes nothing, logs no deploy (F36)"   '[ "$got" -eq 0 ] && ! grep -q "deploying" "$root/out" && [ "$(grep -c "dist/bootstrap-super-admin.mjs" "$STUB_CALLS")" -eq 1 ] && grep -q "run --rm --no-deps -T api-admin dist/bootstrap-super-admin.mjs" "$STUB_CALLS" && [ "$(tail -n 4 "$root/stub-state/bootstrap-args" | paste -sd "|")" = "--name|Test Owner; rm -rf /|--locale|ur" ] && ! grep -q -- "--scale" "$STUB_CALLS" && ! grep -q " pull " "$STUB_CALLS" && [ "$(running)" = "$(rel 11)" ]'
: >"$STUB_CALLS"; STUB_FAIL_BOOTSTRAP=1 run rel-11 --bootstrap-super-admin --name Test; got=$?
check "--bootstrap-super-admin: a refusal (e.g. a Super Admin exists) fails the run"   '[ "$got" -eq 1 ] && grep -q "did not create a Super Admin" "$root/out"'
run rel-11 --verify-roles --name Test; got=$?
check "other modes refuse extra arguments"   '[ "$got" -eq 2 ] && grep -q "unexpected arguments" "$root/out"'

echo "== $failures failure(s)"
[ "$failures" -eq 0 ]
