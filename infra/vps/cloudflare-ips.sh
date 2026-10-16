#!/usr/bin/env bash
# Refreshes the Cloudflare IP ranges the origin accepts on 443 (04 §12.2, DECISIONS #54) and re-applies the
# DOCKER-USER firewall rules. Run as root by provision.sh, the weekly mc-cloudflare-ips.timer and after Docker starts
# (mc-docker-user-firewall.service). Idempotent; atomic ipset swap, so there is no window without the rule.
#   cloudflare-ips.sh            fetch + validate + apply
#   cloudflare-ips.sh --apply    re-apply rules from the saved list (no network; used at boot)
#   cloudflare-ips.sh --check <v4 file> <v6 file>   validate two lists only (tests; no network, no firewall)
# DRAFT 14 Oct 2026 — reviewed and first run with the owner in T0.14.
set -euo pipefail

LIST=${MC_CF_LIST:-/etc/masjid-connect/cloudflare-ips.txt}
URL_V4=https://www.cloudflare.com/ips-v4
URL_V6=https://www.cloudflare.com/ips-v6
PORT=443 # the host port the edge router publishes (docker-compose.edge.yml)

log() { printf 'cloudflare-ips: %s\n' "$*"; }

# A fetched range wider than /8 (IPv4) or /20 (IPv6) is refused: a tampered or broken list must never open 443 to
# large parts of the internet (re-review L9). Cloudflare's own ranges are /12–/22 and /29–/32.
too_wide() { # <list file> — prints the offending ranges
  awk -F/ '($1 ~ /:/ && $2 < 20) || ($1 !~ /:/ && $2 < 8)' "$1"
}

if [ "${1:-}" != --apply ]; then
  tmp=$(mktemp)
  trap 'rm -f "$tmp" "$tmp.v4" "$tmp.v6"' EXIT
  if [ "${1:-}" = --check ]; then
    cp "$2" "$tmp.v4"
    cp "$3" "$tmp.v6"
  else
    curl -fsS --max-time 20 "$URL_V4" >"$tmp.v4"
    curl -fsS --max-time 20 "$URL_V6" >"$tmp.v6"
  fi
  # Accept only well-formed CIDRs; refuse suspiciously small lists rather than locking Cloudflare out.
  grep -E '^[0-9]{1,3}(\.[0-9]{1,3}){3}/[0-9]{1,2}$' "$tmp.v4" >"$tmp" || true
  v4=$(wc -l <"$tmp")
  grep -Ei '^[0-9a-f:]+::?[0-9a-f:]*/[0-9]{1,3}$' "$tmp.v6" >>"$tmp" || true
  total=$(wc -l <"$tmp")
  if [ "$v4" -lt 5 ] || [ $((total - v4)) -lt 3 ]; then
    log "refusing: only $v4 IPv4 / $((total - v4)) IPv6 ranges received — keeping the previous list"
    exit 1
  fi
  wide=$(too_wide "$tmp")
  if [ -n "$wide" ]; then
    log "refusing: ranges wider than /8 (IPv4) or /20 (IPv6): $(echo "$wide" | tr '\n' ' ')— keeping the previous list"
    exit 1
  fi
  if [ "${1:-}" = --check ]; then
    log "check passed: $v4 IPv4 + $((total - v4)) IPv6 ranges"
    exit 0
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

# DOCKER-USER (FORWARD) sees packets after Docker's DNAT, so match the ORIGINAL destination port with conntrack, and
# only traffic that ARRIVES on the public interface: container egress to any :443 (push services, Cloudinary,
# Turnstile, Sentry, the purge API) also passes DOCKER-USER and must not match (review S-H2).
ext_if() { # <ip family flag> — the interface of the default route
  local dev
  dev=$(ip "$1" -o route show default 2>/dev/null | awk '{for (i = 1; i < NF; i++) if ($i == "dev") {print $(i + 1); exit}}')
  if [[ "$dev" =~ ^[a-zA-Z0-9._@-]{1,15}$ ]]; then printf '%s' "$dev"; fi
}
EXT_IF=$(ext_if -4)
[ -n "$EXT_IF" ] || { log "no IPv4 default route — cannot tell the public interface"; exit 1; }
EXT_IF6=$(ext_if -6)
EXT_IF6=${EXT_IF6:-$EXT_IF}

apply_rules() { # <iptables binary> <set> <public interface>
  local bin=$1 set=$2 dev=$3
  "$bin" -N DOCKER-USER 2>/dev/null || true
  local cf=(-i "$dev" -p tcp -m conntrack --ctstate NEW --ctorigdstport "$PORT" -m set ! --match-set "$set" src
    -m comment --comment mc-cloudflare-only -j DROP)
  "$bin" -C DOCKER-USER "${cf[@]}" 2>/dev/null || "$bin" -I DOCKER-USER 1 "${cf[@]}"
  # Remove older forms of our rule (e.g. without the interface match) only after the current one is in place.
  local line old
  while read -r line; do
    read -r -a old <<<"${line/-A DOCKER-USER/}"
    "$bin" -D DOCKER-USER "${old[@]}"
  done < <("$bin" -S DOCKER-USER | grep -- '--comment mc-cloudflare-only' | grep -vF -- "-i $dev " || true)
}
apply_rules iptables cloudflare4 "$EXT_IF"
apply_rules ip6tables cloudflare6 "$EXT_IF6"
# Containers never need the cloud metadata service (SSRF hardening, review S-L8): forwarded traffic only.
meta=(! -i "$EXT_IF" -d 169.254.169.254 -m comment --comment mc-no-metadata -j DROP)
iptables -C DOCKER-USER "${meta[@]}" 2>/dev/null || iptables -I DOCKER-USER 1 "${meta[@]}"
log "DOCKER-USER: port $PORT on $EXT_IF/$EXT_IF6 accepts only the Cloudflare sets; container egress unaffected"
