#!/usr/bin/env bash
# Tests infra/vps/deploy.sh (DECISIONS #55, #56, #59) without a server or Docker daemon: a throwaway signing key,
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
manifest() { # <dir> <environment> <server image> [web image] [release] [created]
  local web=${4:-} release=${5:-0123456789abcdef0123456789abcdef01234567} created=${6:-2026-10-14T00:00:00.000Z}
  jq -n --arg env "$2" --arg server "$3" --arg web "$web" --arg release "$release" --arg created "$created" \
    '{environment: $env, release: $release, created: $created,
      images: ({server: $server} + (if $web == "" then {} else {web: $web} end))}' >"$1/release-manifest.json"
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
# followed), prints a compose config for the hardening policy, and reports every container healthy.
stub=$root/stub
mkdir -p "$stub/lib" "$root/stub-state"
cat >"$stub/docker" <<'STUB'
#!/bin/bash
echo "$(basename "$0") WEB_IMAGE=${WEB_IMAGE:-} $*" >>"$STUB_CALLS"
[ "$(basename "$0")" = docker ] || exit 0
args=" $* "
case "$args" in
  *" config --format json "*) cat "$STUB_COMPOSE_JSON" ;;
  *" ps -q "*)
    for svc in "$@"; do if [ -f "$STUB_STATE/$svc" ]; then cat "$STUB_STATE/$svc"; fi; done ;;
  *" up "*" --scale "*)
    [ -z "${STUB_FAIL_UP:-}" ] || exit 1
    spec=$(sed -E 's/.* --scale ([^ ]+) .*/\1/' <<<"$args")
    svc=${spec%=*} n=${spec#*=}
    touch "$STUB_STATE/$svc"
    while [ "$(wc -l <"$STUB_STATE/$svc")" -lt "$n" ]; do echo "$svc-$RANDOM$RANDOM" >>"$STUB_STATE/$svc"; done ;;
  *" up "*) [ -z "${STUB_FAIL_UP:-}" ] ;;
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
service() { # <bind source or "">
  jq -n --arg src "$1" '{read_only: true, cap_drop: ["ALL"], security_opt: ["no-new-privileges:true"],
    volumes: (if $src == "" then [] else [{type: "bind", source: $src, target: "/x", read_only: true}] end)}'
}
jq -n --argjson web "$(service "$root/config/certs")" --argjson redis "$(service "$root/repo/infra/compose/redis.conf")" \
  --argjson api "$(service "")" \
  '{services: {web: $web, redis: $redis, "api-public": $api, "api-admin": $api, worker: $api}}' >"$root/compose-ok.json"
jq '.services.worker.privileged = true' "$root/compose-ok.json" >"$root/compose-privileged.json"
jq '.services.worker.volumes = [{type: "bind", source: "/", target: "/host"}]' "$root/compose-ok.json" >"$root/compose-hostmount.json"
jq '.services.web.ports = [{target: 8443, published: "443"}]' "$root/compose-ok.json" >"$root/compose-ports.json"
export STUB_COMPOSE_JSON=$root/compose-ok.json
state=$root/flow-state
run() { # <case dir> [deploy.sh option]
  local dir=$1
  shift
  PATH="$stub:$PATH" MC_RELEASE_BASE_URL="http://127.0.0.1:8999/$dir" MC_CONFIG_DIR="$root/config" \
    MC_STATE_DIR="$state" MC_REPO_DIR="$root/repo" MC_LIB_DIR="$stub/lib" MC_LOCK_FILE="$root/lock" \
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
check "release 1 deploys: checkout of the signed commit, images exported, 2 + 2 + 1 containers" \
  '[ "$got" -eq 0 ] && [ "$(running)" = "$(rel 1)" ] && grep -q "checkout --quiet --detach $(rel 1)" "$STUB_CALLS" && grep -q "WEB_IMAGE=$web compose .* up " "$STUB_CALLS" && [ "$(lines "$STUB_STATE/api-public")" -eq 2 ] && [ "$(lines "$STUB_STATE/web")" -eq 1 ]'
: >"$STUB_CALLS"; run rel-1; got=$?
check "same release again is a quiet no-op" '[ "$got" -eq 0 ] && [ "$(deployed)" -eq 1 ] && [ ! -s "$STUB_CALLS" ] && [ ! -s "$root/out" ]'
old_api=$(tr '\n' ' ' <"$STUB_STATE/api-public" | sed 's/ $//')
: >"$STUB_CALLS"; run rel-2; got=$?
check "server-only release keeps the running web image" \
  '[ "$got" -eq 0 ] && [ "$(running)" = "$(rel 2)" ] && grep -q "WEB_IMAGE=$web compose .* up " "$STUB_CALLS"'
check "rolling restart: 2 new api-public containers next to the 2 old ones, then the old ones stopped, archived, removed" \
  'grep -q -- "--scale api-public=4 api-public" "$STUB_CALLS" && [ "$(lines "$STUB_STATE/api-public")" -eq 2 ] && ! grep -qwF -e "${old_api%% *}" -e "${old_api##* }" "$STUB_STATE/api-public" && grep -q "stop -t 30 $old_api" "$STUB_CALLS" && grep -q "log-archive --container $old_api" "$STUB_CALLS"'
run rel-3; got=$?
check "release 3 deploys" '[ "$got" -eq 0 ] && [ "$(running)" = "$(rel 3)" ]'
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
for bad in privileged hostmount ports; do
  STUB_COMPOSE_JSON=$root/compose-$bad.json run rel-6; got=$?
  check "compose policy refuses a release whose compose file has: $bad (review S-H1)" \
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

echo "== $failures failure(s)"
[ "$failures" -eq 0 ]
