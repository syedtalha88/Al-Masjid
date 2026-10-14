#!/usr/bin/env bash
# Tests the release verification of infra/vps/deploy.sh (DECISIONS #55) without a server or Docker daemon:
# a throwaway signing key, manifests served by a local HTTP server, `deploy.sh --check-only`.
# Run (from the repo root):
#   docker run --rm -v "$PWD/infra/vps:/vps:ro" ubuntu:24.04 bash /vps/test/deploy-verify.test.sh
set -uo pipefail

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq >/dev/null && apt-get install -y -qq openssh-client jq curl python3 >/dev/null || exit 1

root=$(mktemp -d)
mkdir -p "$root/config" "$root/state" "$root/www/ok" "$root/www/bad"
ssh-keygen -q -t ed25519 -N '' -C test -f "$root/key"
ssh-keygen -q -t ed25519 -N '' -C other -f "$root/other-key"
printf 'masjid-connect-staging namespaces="masjid-connect-release" %s\n' "$(cat "$root/key.pub")" >"$root/config/allowed_signers"

digest() { printf 'sha256:%064d' "$1"; }
manifest() { # <dir> <environment> <server image> [web image]
  local web=${4:-}
  jq -n --arg env "$2" --arg server "$3" --arg web "$web" \
    '{environment: $env, release: "0123456789abcdef0123456789abcdef01234567", created: "2026-10-14T00:00:00Z",
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

echo "== $failures failure(s)"
[ "$failures" -eq 0 ]
