#!/usr/bin/env bash
# check.sh — origin TLS files (PROGRESS F34). Runs in a throw-away ubuntu:24.04 container (CI):
#   docker run --rm -v "$PWD/infra/vps:/vps:ro" ubuntu:24.04 bash /vps/test/check-certs.test.sh
# Good files pass; the first staging deploy's failure (PEM BEGIN/END lines missing) and a key that belongs to another
# certificate fail.
set -uo pipefail
apt-get update -qq >/dev/null && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq openssl >/dev/null

failures=0
expect() { # <label> <PASS|FAIL> <check.sh line label>
  local got
  got=$(bash /vps/check.sh 2>/dev/null | grep -F "  $3" | head -n 1 | cut -c1-4)
  if [ "$got" = "$2" ]; then echo "PASS  $1"; else echo "FAIL  $1 (expected $2, got '${got:-no line}')"; failures=$((failures + 1)); fi
}
new_pair() {
  openssl req -x509 -newkey rsa:2048 -nodes -keyout origin-key.pem -out origin.pem -days "${1:-365}" -subj /CN=t 2>/dev/null
  chown 0:1000 ./*.pem && chmod 640 ./*.pem
}

d=/etc/masjid-connect/staging
mkdir -p "$d/certs" && touch "$d/api-public.env" && chmod 600 "$d/api-public.env"
# Staging is deployed (a release is recorded); production has env files but was never deployed and has no certs.
mkdir -p /var/lib/masjid-connect/staging && echo "2026-10-16T00:00:00Z abc def" >/var/lib/masjid-connect/staging/releases.log
mkdir -p /etc/masjid-connect/production && touch /etc/masjid-connect/production/api-public.env
cd "$d/certs" || exit 1
openssl req -x509 -newkey rsa:2048 -nodes -keyout /tmp/ca.key -out cloudflare-origin-pull-ca.pem -days 365 -subj /CN=ca 2>/dev/null
new_pair

expect "valid certificate parses" PASS "staging: origin certificate parses (PEM)"
expect "valid key parses" PASS "staging: origin key parses (PEM)"
expect "matching key" PASS "staging: origin key matches the certificate"
expect "certificate valid for 30+ days" PASS "staging: origin certificate valid for 30+ days"
expect "CA parses" PASS "staging: Cloudflare origin-pull CA parses (PEM)"
expect "mode 640 root:1000" PASS "$d/certs/origin-key.pem is 640 root:1000"

sed -i '/-----/d' origin.pem origin-key.pem
expect "PEM lines missing: certificate fails" FAIL "staging: origin certificate parses (PEM)"
expect "PEM lines missing: key fails" FAIL "staging: origin key parses (PEM)"
expect "PEM lines missing: match fails (two empty keys are not a match)" FAIL "staging: origin key matches the certificate"

new_pair
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out origin-key.pem 2>/dev/null
chown 0:1000 origin-key.pem && chmod 640 origin-key.pem
expect "key of another certificate: match fails" FAIL "staging: origin key matches the certificate"

new_pair 10
expect "certificate expiring within 30 days fails" FAIL "staging: origin certificate valid for 30+ days"

chmod 644 origin-key.pem
expect "world-readable key fails" FAIL "$d/certs/origin-key.pem is 640 root:1000"

out=$(bash /vps/check.sh 2>/dev/null)
if grep -q "^WARN  production: not deployed yet" <<<"$out" && ! grep -q "^FAIL  production:" <<<"$out"; then
  echo "PASS  an environment that was never deployed is noted, not failed, for missing certificates"
else
  echo "FAIL  an environment that was never deployed is noted, not failed, for missing certificates"
  failures=$((failures + 1))
fi
echo "== $failures failure(s)"
[ "$failures" -eq 0 ]
