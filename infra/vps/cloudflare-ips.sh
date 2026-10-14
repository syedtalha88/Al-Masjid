#!/usr/bin/env bash
# Refreshes the Cloudflare IP ranges the origin accepts on 443 (04 §12.2, DECISIONS #54) and re-applies the
# DOCKER-USER firewall rules. Run as root by provision.sh, the weekly mc-cloudflare-ips.timer and after Docker starts
# (mc-docker-user-firewall.service). Idempotent; atomic ipset swap, so there is no window without the rule.
#   cloudflare-ips.sh            fetch + validate + apply
#   cloudflare-ips.sh --apply    re-apply rules from the saved list (no network; used at boot)
# DRAFT 14 Oct 2026 — reviewed and first run with the owner in T0.14.
set -euo pipefail

LIST=${MC_CF_LIST:-/etc/masjid-connect/cloudflare-ips.txt}
URL_V4=https://www.cloudflare.com/ips-v4
URL_V6=https://www.cloudflare.com/ips-v6
PORT=443 # the host port the edge router publishes (docker-compose.edge.yml)

log() { printf 'cloudflare-ips: %s\n' "$*"; }

if [ "${1:-}" != --apply ]; then
  tmp=$(mktemp)
  trap 'rm -f "$tmp" "$tmp.v4" "$tmp.v6"' EXIT
  curl -fsS --max-time 20 "$URL_V4" >"$tmp.v4"
  curl -fsS --max-time 20 "$URL_V6" >"$tmp.v6"
  # Accept only well-formed CIDRs; refuse suspiciously small lists rather than locking Cloudflare out.
  grep -E '^[0-9]{1,3}(\.[0-9]{1,3}){3}/[0-9]{1,2}$' "$tmp.v4" >"$tmp" || true
  v4=$(wc -l <"$tmp")
  grep -Ei '^[0-9a-f:]+::?[0-9a-f:]*/[0-9]{1,3}$' "$tmp.v6" >>"$tmp" || true
  total=$(wc -l <"$tmp")
  if [ "$v4" -lt 5 ] || [ $((total - v4)) -lt 3 ]; then
    log "refusing: only $v4 IPv4 / $((total - v4)) IPv6 ranges received — keeping the previous list"
    exit 1
  fi
  install -m 644 -D "$tmp" "$LIST"
  log "saved $v4 IPv4 + $((total - v4)) IPv6 ranges to $LIST"
fi

[ -s "$LIST" ] || { log "no list at $LIST"; exit 1; }

# Build new sets and swap them in atomically.
ipset create -exist cloudflare4 hash:net family inet
ipset create -exist cloudflare6 hash:net family inet6
ipset create -exist cloudflare4-new hash:net family inet
ipset create -exist cloudflare6-new hash:net family inet6
ipset flush cloudflare4-new
ipset flush cloudflare6-new
while read -r cidr; do
  case "$cidr" in
    *:*) ipset add -exist cloudflare6-new "$cidr" ;;
    *) ipset add -exist cloudflare4-new "$cidr" ;;
  esac
done <"$LIST"
ipset swap cloudflare4-new cloudflare4
ipset swap cloudflare6-new cloudflare6
ipset destroy cloudflare4-new
ipset destroy cloudflare6-new

# DOCKER-USER sees packets after Docker's DNAT, so match the ORIGINAL destination port with conntrack.
# Anything to host port 443 that is not from Cloudflare is dropped before it reaches the edge router.
apply_rule() { # <iptables binary> <set>
  local bin=$1 set=$2
  "$bin" -N DOCKER-USER 2>/dev/null || true
  local rule=(-p tcp -m conntrack --ctstate NEW --ctorigdstport "$PORT" -m set ! --match-set "$set" src
    -m comment --comment mc-cloudflare-only -j DROP)
  "$bin" -C DOCKER-USER "${rule[@]}" 2>/dev/null || "$bin" -I DOCKER-USER 1 "${rule[@]}"
}
apply_rule iptables cloudflare4
apply_rule ip6tables cloudflare6
log "DOCKER-USER: port $PORT accepts only the Cloudflare sets"
