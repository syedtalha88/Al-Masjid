#!/usr/bin/env bash
# check.sh — re-review L6 checks in a throw-away ubuntu:24.04 container (CI):
#   docker run --rm -v "$PWD/infra/vps:/vps:ro" ubuntu:24.04 bash /vps/test/check-ops.test.sh
# Recorded unit failures, log-archive freshness, host-layer ownership/VERSION, and the live origin-lock probe (an
# openssl server on 127.0.0.1:443 that requires a client certificate must pass; one that does not must fail).
set -uo pipefail
apt-get update -qq >/dev/null && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq openssl curl >/dev/null

failures=0
expect() { # <label> <PASS|FAIL> <check.sh line label>
  local got
  got=$(bash /vps/check.sh 2>/dev/null | grep -F "  $3" | head -n 1 | cut -c1-4)
  if [ "$got" = "$2" ]; then echo "PASS  $1"; else echo "FAIL  $1 (expected $2, got '${got:-no line}')"; failures=$((failures + 1)); fi
}

# A deployed staging with an app host.
mkdir -p /etc/masjid-connect/staging /var/lib/masjid-connect/staging
echo "2026-10-16T00:00:00Z abc def" >/var/lib/masjid-connect/staging/releases.log
printf 'APP_HOST=app-staging.example.test\n' >/etc/masjid-connect/staging/web.env
chmod 600 /etc/masjid-connect/staging/web.env

# Recorded failures
expect "no failure markers" PASS "no recorded deploy / log-archive failures"
mkdir -p /var/lib/masjid-connect/failures
echo "2026-10-16T03:00:00Z" >/var/lib/masjid-connect/failures/mc-deploy@staging.service
expect "a failure marker is reported" FAIL "unit mc-deploy@staging.service failed at 2026-10-16T03:00:00Z"
rm -f /var/lib/masjid-connect/failures/*

# Log archive freshness
mkdir -p /var/log/masjid-connect/archive/2026-10-16 && chmod 700 /var/log/masjid-connect/archive
touch -d '5 hours ago' /var/log/masjid-connect/archive/2026-10-16/api-public-010000.log.gz.age
expect "only old archives: stale" FAIL "log archive is fresh (an archive from the last 2 hours)"
touch /var/log/masjid-connect/archive/2026-10-16/api-public-050000.log.gz.age
expect "a recent archive: fresh" PASS "log archive is fresh (an archive from the last 2 hours)"

# Host layer
lib=/usr/local/lib/masjid-connect
mkdir -p "$lib" && chmod 755 "$lib" && printf '%040d\n' 7 >"$lib/VERSION" && chmod 644 "$lib/VERSION"
expect "root-owned, not writable by others" PASS "host layer is root-owned and not group/world-writable"
expect "VERSION is a commit" PASS "host layer VERSION"
chmod 666 "$lib/VERSION"
expect "a world-writable file fails" FAIL "host layer is root-owned and not group/world-writable"
chmod 644 "$lib/VERSION" && echo "not-a-sha" >"$lib/VERSION"
expect "a VERSION that is no commit fails" FAIL "host layer VERSION records the reviewed commit"

# Origin lock probe
cd /tmp || exit 1
openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -days 1 -subj /CN=app-staging.example.test 2>/dev/null
expect "nothing listening is not a pass" FAIL "staging: origin lock probe inconclusive"
openssl s_server -accept 443 -cert cert.pem -key key.pem -Verify 1 -www -quiet >/dev/null 2>&1 &
server=$!
sleep 1
expect "client certificate required: pass" PASS "staging: origin refuses TLS without the Cloudflare client certificate"
kill "$server" 2>/dev/null
wait "$server" 2>/dev/null
openssl s_server -accept 443 -cert cert.pem -key key.pem -www -quiet >/dev/null 2>&1 &
server=$!
sleep 1
expect "no client certificate needed: fail" FAIL "staging: origin answered without the Cloudflare client certificate"
kill "$server" 2>/dev/null

if [ "$failures" -ne 0 ]; then
  echo "$failures failed"
  exit 1
fi
echo "all check.sh L6 checks passed"
