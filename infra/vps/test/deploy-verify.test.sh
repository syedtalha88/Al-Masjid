#!/usr/bin/env bash
# Tests infra/vps/deploy.sh (DECISIONS #55, #56) without a server or Docker daemon: a throwaway signing key,
# manifests served by a local HTTP server; release verification via `--check-only`, then the deploy / rollback flow
# with git and docker replaced by stubs that record their calls.
# Run (from the repo root):
#   docker run --rm -v "$PWD/infra/vps:/vps:ro" ubuntu:24.04 bash /vps/test/deploy-verify.test.sh
# shellcheck disable=SC2016 # check() conditions are single-quoted on purpose: they are eval'd after each run
set -uo pipefail

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq >/dev/null && apt-get install -y -qq openssh-client jq curl python3 >/dev/null || exit 1

root=$(mktemp -d)
mkdir -p "$root/config" "$root/state" "$root/www/ok" "$root/www/bad"
ssh-keygen -q -t ed25519 -N '' -C test -f "$root/key"
ssh-keygen -q -t ed25519 -N '' -C other -f "$root/other-key"
printf 'masjid-connect-staging namespaces="masjid-connect-release" %s\n' "$(cat "$root/key.pub")" >"$root/config/allowed_signers"

digest() { printf 'sha256:%064d' "$1"; }
manifest() { # <dir> <environment> <server image> [web image] [release]
  local web=${4:-} release=${5:-0123456789abcdef0123456789abcdef01234567}
  jq -n --arg env "$2" --arg server "$3" --arg web "$web" --arg release "$release" \
    '{environment: $env, release: $release, created: "2026-10-14T00:00:00Z",
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
    bash /vps/deploy.sh "$4" --check-only >"$root/out" 2>&1
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

expect "a missing manifest is an error" 1 nowhere staging

# --- Deploy + rollback flow: git and docker are stubs that record their calls (no daemon, no repository) --------
stub=$root/stub
mkdir -p "$stub"
cat >"$stub/docker" <<'STUB'
#!/bin/sh
echo "$(basename "$0") WEB_IMAGE=${WEB_IMAGE:-} $*" >>"$STUB_CALLS"
case " $* " in *" up "*) [ -z "${STUB_FAIL_UP:-}" ] ;; esac
STUB
cp "$stub/docker" "$stub/git"
chmod +x "$stub/docker" "$stub/git"
export STUB_CALLS=$root/calls
state=$root/flow-state
run() { # <case dir> [deploy.sh option]
  local dir=$1
  shift
  PATH="$stub:$PATH" MC_RELEASE_BASE_URL="http://127.0.0.1:8999/$dir" MC_CONFIG_DIR="$root/config" \
    MC_STATE_DIR="$state" MC_REPO_DIR="$root/repo" bash /vps/deploy.sh staging "$@" >"$root/out" 2>&1
}
check() { # <label> <condition>
  if eval "$2"; then echo "PASS  $1"; else echo "FAIL  $1"; sed 's/^/      /' "$root/out"; failures=$((failures + 1)); fi
}
rel() { printf '%040d' "$1"; }
running() { tail -n 1 "$state/releases.log" 2>/dev/null | awk '{print $2}'; }
deployed() { if [ -e "$state/releases.log" ]; then wc -l <"$state/releases.log"; else echo 0; fi; }
publish() { # <case> <release n> [web image]
  local d
  d=$(case_dir "$1")
  manifest "$d" staging "$server" "${3:-}" "$(rel "$2")"
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
: >"$STUB_CALLS"; run rel-1; got=$?
check "release 1 deploys: checkout of the signed commit, images exported" \
  '[ "$got" -eq 0 ] && [ "$(running)" = "$(rel 1)" ] && grep -q "checkout --quiet --detach $(rel 1)" "$STUB_CALLS" && grep -q "WEB_IMAGE=$web compose .* up " "$STUB_CALLS"'
: >"$STUB_CALLS"; run rel-1; got=$?
check "same release again is a quiet no-op" '[ "$got" -eq 0 ] && [ "$(deployed)" -eq 1 ] && [ ! -s "$STUB_CALLS" ] && [ ! -s "$root/out" ]'
: >"$STUB_CALLS"; run rel-2; got=$?
check "server-only release keeps the running web image" \
  '[ "$got" -eq 0 ] && [ "$(running)" = "$(rel 2)" ] && grep -q "WEB_IMAGE=$web compose .* up " "$STUB_CALLS"'
run rel-3; got=$?
check "release 3 deploys" '[ "$got" -eq 0 ] && [ "$(running)" = "$(rel 3)" ]'
: >"$STUB_CALLS"; run rel-3 --rollback; got=$?
check "rollback returns to release 2 with the web image it ran with; 3 is skipped" \
  '[ "$got" -eq 0 ] && [ "$(running)" = "$(rel 2)" ] && grep -qx "$(rel 3)" "$state/rolled-back" && grep -q "WEB_IMAGE=$web compose .* up " "$STUB_CALLS"'
run rel-3; got=$?
check "timer does not redeploy the skipped release" '[ "$got" -eq 0 ] && [ "$(running)" = "$(rel 2)" ]'
run rel-3 --rollback; got=$?
check "second rollback goes further back (1), not forward to 3" \
  '[ "$got" -eq 0 ] && [ "$(running)" = "$(rel 1)" ]'
run rel-3 --rollback; got=$?
check "nothing older: rollback refuses (never forward to 2)" '[ "$got" -eq 1 ] && [ "$(running)" = "$(rel 1)" ]'
run rel-3; got=$?
check "timer still waits for a newer release" '[ "$got" -eq 0 ] && [ "$(running)" = "$(rel 1)" ]'
: >"$STUB_CALLS"; run rel-4; got=$?
check "a newer release deploys (keeps web image of 1) and clears the skip" \
  '[ "$got" -eq 0 ] && [ "$(running)" = "$(rel 4)" ] && [ ! -e "$state/rolled-back" ] && grep -q "WEB_IMAGE=$web compose .* up " "$STUB_CALLS"'

echo "== $failures failure(s)"
[ "$failures" -eq 0 ]
