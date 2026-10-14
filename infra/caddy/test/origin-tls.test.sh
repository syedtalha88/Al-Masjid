#!/usr/bin/env bash
# Tests Caddy's `tls-origin` mode (Authenticated Origin Pulls — 04 §12.2, DECISIONS #57; verifier V-2) before any
# server: throwaway CA + client certificate (like ours uploaded to Cloudflare), a foreign CA's client certificate and
# a self-signed origin certificate; Caddy runs the real Caddyfile with CADDY_TLS=origin. Expected: TLS fails without a
# client certificate and with the foreign one; it succeeds only with the certificate our CA signed.
# Run (from the repo root; needs Docker):  bash infra/caddy/test/origin-tls.test.sh
# Images can be pinned from CI: CADDY_IMAGE, TOOLS_IMAGE.
# shellcheck disable=SC2016 # the tools() scripts are single-quoted on purpose: they run inside the container
set -uo pipefail

CADDY_IMAGE=${CADDY_IMAGE:-caddy:2.11.7-alpine}
TOOLS_IMAGE=${TOOLS_IMAGE:-ubuntu:24.04}
id=mc-origin-tls-$$
repo=$(cd "$(dirname "$0")/../../.." && pwd)
export MSYS_NO_PATHCONV=1 # Git Bash on Windows: keep container paths as they are

cleanup() {
  docker rm -f "$id-caddy" >/dev/null 2>&1
  docker volume rm "$id-certs" >/dev/null 2>&1
  docker network rm "$id" >/dev/null 2>&1
}
trap cleanup EXIT
docker network create "$id" >/dev/null
docker volume create "$id-certs" >/dev/null

tools() { # <script> — runs in the tools container with the cert volume at /certs and openssl + curl available
  docker run --rm --network "$id" -v "$id-certs:/certs" "$TOOLS_IMAGE" bash -c \
    "export DEBIAN_FRONTEND=noninteractive; (command -v openssl && command -v curl) >/dev/null 2>&1 || { apt-get update -qq >/dev/null && apt-get install -y -qq openssl curl >/dev/null 2>&1; }; $1"
}

# Same commands as the owner ran for DECISIONS #57, plus a foreign CA and a self-signed origin certificate.
tools '
set -e; cd /certs; umask 022
mk_ca() { openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out $1.key 2>/dev/null
  openssl req -x509 -new -key $1.key -sha256 -days 30 -subj "/CN=$1" -out $1.crt; }
mk_client() { openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out $1.key 2>/dev/null
  openssl req -new -key $1.key -subj "/CN=$1" -out $1.csr
  printf "basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=clientAuth\n" > leaf.ext
  openssl x509 -req -in $1.csr -CA $2.crt -CAkey $2.key -CAcreateserial -days 30 -sha256 -extfile leaf.ext -out $1.crt 2>/dev/null; }
mk_ca our-ca; mk_ca foreign-ca
mk_client cloudflare our-ca; mk_client intruder foreign-ca
openssl req -x509 -newkey rsa:2048 -nodes -keyout origin-key.pem -out origin.pem -days 30 -subj "/CN=app.test" \
  -addext "subjectAltName=DNS:app.test,DNS:admin.test" 2>/dev/null
cp our-ca.crt cloudflare-origin-pull-ca.pem
chmod 644 ./*' || { echo "FAIL  certificate generation"; exit 1; }

docker run -d --name "$id-caddy" --network "$id" --network-alias origin \
  -v "$repo/infra/caddy/Caddyfile:/etc/caddy/Caddyfile:ro" -v "$id-certs:/certs:ro" \
  -e APP_HOST=app.test -e ADMIN_HOST=admin.test -e CADDY_TLS=origin -e MEDIA_ORIGIN=https://media.test \
  -e API_PUBLIC_UPSTREAM=127.0.0.1:9 -e API_ADMIN_UPSTREAM=127.0.0.1:9 \
  "$CADDY_IMAGE" caddy run --config /etc/caddy/Caddyfile >/dev/null || { echo "FAIL  caddy did not start"; exit 1; }

# One curl per case, all from the tools container: prints the curl exit code per case.
results=$(tools '
for _ in $(seq 1 30); do curl -sk -o /dev/null --resolve app.test:8443:$(getent hosts origin | cut -d" " -f1) https://app.test:8443/ --cert /certs/cloudflare.crt --key /certs/cloudflare.key && break; sleep 1; done
ip=$(getent hosts origin | cut -d" " -f1)
probe() { curl -sk -o /dev/null --max-time 5 --resolve app.test:8443:$ip https://app.test:8443/ "$@"; echo $?; }
echo "none=$(probe)"
echo "foreign=$(probe --cert /certs/intruder.crt --key /certs/intruder.key)"
echo "ours=$(probe --cert /certs/cloudflare.crt --key /certs/cloudflare.key)"
echo "sni=$(curl -sk -o /dev/null --max-time 5 --resolve other.test:8443:$ip https://other.test:8443/ --cert /certs/cloudflare.crt --key /certs/cloudflare.key; echo $?)"')

failures=0
check() { # <label> <case> <predicate on the curl exit code>
  local code
  code=$(sed -n "s/^$2=//p" <<<"$results")
  if [ -n "$code" ] && eval "[ $code $3 ]"; then echo "PASS  $1 (curl $code)"; else echo "FAIL  $1 (curl ${code:-?})"; failures=$((failures + 1)); fi
}
check "no client certificate → TLS refused" none "-ne 0"
check "client certificate from a foreign CA → TLS refused" foreign "-ne 0"
check "client certificate signed by our origin-pull CA → served" ours "-eq 0"
check "unknown host name (SNI) → refused even with our certificate" sni "-ne 0"
if [ "$failures" -ne 0 ]; then docker logs "$id-caddy" 2>&1 | tail -20; fi
echo "== $failures failure(s)"
[ "$failures" -eq 0 ]
