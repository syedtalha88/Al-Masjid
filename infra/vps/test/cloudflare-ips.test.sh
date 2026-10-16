#!/usr/bin/env bash
# Tests the list validation of infra/vps/cloudflare-ips.sh (re-review L9) without network or firewall:
#   docker run --rm -v "$PWD/infra/vps:/vps:ro" ubuntu:24.04 bash /vps/test/cloudflare-ips.test.sh
set -uo pipefail

failures=0
dir=$(mktemp -d)
v4ok=$(printf '173.245.48.0/20\n103.21.244.0/22\n103.22.200.0/22\n104.16.0.0/13\n172.64.0.0/13\n')
v6ok=$(printf '2400:cb00::/32\n2606:4700::/32\n2803:f800::/32\n')
run() { # <label> <expected exit> <v4 content> <v6 content>
  printf '%s\n' "$3" >"$dir/v4"
  printf '%s\n' "$4" >"$dir/v6"
  MC_CF_LIST="$dir/list" bash "$(dirname "$0")/../cloudflare-ips.sh" --check "$dir/v4" "$dir/v6" >"$dir/out" 2>&1
  got=$?
  if [ "$got" -eq "$2" ]; then echo "PASS  $1"; else echo "FAIL  $1 (exit $got)"; cat "$dir/out"; failures=$((failures + 1)); fi
}

run "Cloudflare-like lists pass" 0 "$v4ok" "$v6ok"
run "0.0.0.0/0 is refused" 1 "$v4ok"$'\n0.0.0.0/0' "$v6ok"
run "an IPv4 /7 is refused" 1 "$v4ok"$'\n10.0.0.0/7' "$v6ok"
run "an IPv4 /8 is accepted" 0 "$v4ok"$'\n10.0.0.0/8' "$v6ok"
run "::/0 is refused" 1 "$v4ok" "$v6ok"$'\n::/0'
run "an IPv6 /19 is refused" 1 "$v4ok" "$v6ok"$'\n2400::/19'
run "too few ranges are refused" 1 '173.245.48.0/20' "$v6ok"
if [ "$failures" -ne 0 ]; then
  echo "$failures failed"
  exit 1
fi
echo "all cloudflare-ips checks passed"
