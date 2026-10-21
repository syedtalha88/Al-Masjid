#!/usr/bin/env bash
# Tests infra/vps/make-env.sh (review S-M2, S-M3, verifier V-17) in a throwaway Ubuntu container:
#   docker run --rm -v "$PWD/infra/vps:/vps:ro" -v "<out dir>:/out" ubuntu:24.04 bash /vps/test/make-env.test.sh
# Leaves the generated staging + production files in /out/{staging,production} for scripts/check-make-env.mjs, which
# validates them against the real env schemas (packages/shared/src/env.ts).
# shellcheck disable=SC2016,SC2034 # check() conditions are single-quoted and eval'd (they read got)
set -uo pipefail

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq >/dev/null && apt-get install -y -qq openssl >/dev/null 2>&1 || exit 1

failures=0
check() { # <label> <condition>
  if eval "$2"; then echo "PASS  $1"; else echo "FAIL  $1"; failures=$((failures + 1)); fi
}
val() { sed -n "s/^$2=//p" "$1"; } # <file> <NAME>
root=$(mktemp -d)
mkdir -p "$root/staging" "$root/production"
gen() { MC_CONFIG_DIR="$root/$1" bash /vps/make-env.sh "$@" >"$root/out" 2>&1; }

gen staging; got=$?
check "staging: files written" '[ "$got" -eq 0 ] && [ -s "$root/staging/worker.env" ] && [ -s "$root/staging/redis-users.acl" ]'
check "staging: env files 600, ACL 400 owned by Redis uid 999" \
  '[ "$(stat -c %a "$root/staging/api-admin.env")" = 600 ] && [ "$(stat -c "%a %u" "$root/staging/redis-users.acl")" = "400 999" ]'
check "staging: marked placeholders + Turnstile test secret" \
  'val "$root/staging/api-public.env" MONGODB_URI_PUBLIC | grep -q NOT-SET && [ "$(val "$root/staging/api-public.env" TURNSTILE_SECRET)" = 1x0000000000000000000000000000000AA ]'
check "staging: Redis ACL passwords match the URLs" \
  'grep -q ">$(val "$root/staging/worker.env" REDIS_URL_WORKER | sed -E "s#redis://worker:([^@]+)@.*#\1#") " "$root/staging/redis-users.acl"'
check "staging: API Redis users have neither SCAN nor RANDOMKEY (review L6, L-5)"   '[ "$(grep -cE "^user (rl_public|admin) .* -scan -randomkey$" "$root/staging/redis-users.acl")" -eq 2 ]'
check "staging: no secret printed (only the public VAPID key and origins)" \
  '! grep -qF "$(val "$root/staging/worker.env" VAPID_PRIVATE_KEY)" "$root/out" && ! grep -qF "$(val "$root/staging/api-admin.env" SESSION_PEPPER)" "$root/out"'

gen staging; got=$?
check "a second run without --force refuses and changes nothing" '[ "$got" -eq 1 ]'

# --force keeps every value: generated keys/passwords and anything filled in by hand later (S-M3).
cp -r "$root/staging" "$root/before"
sed -i 's#^MONGODB_URI_ADMIN=.*#MONGODB_URI_ADMIN=mongodb+srv://mc_admin:real-password@cluster0.example.mongodb.net/#' "$root/staging/api-admin.env"
gen staging --force; got=$?
same() { [ "$(val "$root/before/$1" "$2")" = "$(val "$root/staging/$1" "$2")" ]; }
check "--force keeps FIELD_ENCRYPTION_KEY(+ID), SESSION_PEPPER, VAPID pair, Redis passwords" \
  '[ "$got" -eq 0 ] && same api-admin.env FIELD_ENCRYPTION_KEY && same api-admin.env FIELD_ENCRYPTION_KEY_ID && same api-admin.env SESSION_PEPPER && same worker.env VAPID_PRIVATE_KEY && same worker.env VAPID_PUBLIC_KEY && same worker.env REDIS_URL_WORKER && same redis.env REDIS_HEALTH_PASSWORD && cmp -s "$root/before/redis-users.acl" "$root/staging/redis-users.acl"'
check "--force keeps a real value entered later (Atlas URI)" \
  'val "$root/staging/api-admin.env" MONGODB_URI_ADMIN | grep -q real-password'

gen production; got=$?
check "production: written; external services EMPTY (no placeholders, no test secret)" \
  '[ "$got" -eq 0 ] && [ -z "$(val "$root/production/api-public.env" TURNSTILE_SECRET)" ] && [ -z "$(val "$root/production/api-admin.env" MONGODB_URI_ADMIN)" ] && [ -z "$(val "$root/production/worker.env" CF_ZONE_ID)" ] && ! grep -rq "not-set\|NOT-SET" "$root/production"'
check "production: 24 h payment hold, indexable app, own encryption key id" \
  '[ "$(val "$root/production/worker.env" PAYMENT_HOLD_MINUTES)" = 1440 ] && [ "$(val "$root/production/web.env" APP_ROBOTS)" = all ] && [ "$(val "$root/production/api-admin.env" FIELD_ENCRYPTION_KEY_ID)" = production1 ]'
check "staging and production share no secret" \
  '[ "$(val "$root/staging/api-admin.env" SESSION_PEPPER)" != "$(val "$root/production/api-admin.env" SESSION_PEPPER)" ] && [ "$(val "$root/staging/worker.env" VAPID_PRIVATE_KEY)" != "$(val "$root/production/worker.env" VAPID_PRIVATE_KEY)" ]'

if [ -d /out ]; then
  rm -rf /out/staging /out/production
  cp -r "$root/staging" "$root/production" /out/
  chmod -R a+rX /out/staging /out/production
fi
echo "== $failures failure(s)"
[ "$failures" -eq 0 ]
