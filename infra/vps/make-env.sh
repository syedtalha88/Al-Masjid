#!/usr/bin/env bash
# Creates the per-process env files of one environment on the VPS (CLAUDE.md §8, 01 §7, 04 §12.2; PHASE_00 T0.14).
# Run as root ON THE SERVER — every secret is generated here and never leaves it:
#   make-env.sh <staging|production>            write the files (refuses if any already has content)
#   make-env.sh <staging|production> --force    rewrite the files from the current template, KEEPING every value
#                                               already set (keys, passwords, real service credentials); only
#                                               missing values are generated (review S-M3). Key rotation is a
#                                               manual runbook step (DEPLOY.md), never this script.
# Writes /etc/masjid-connect/<env>/{api-public,api-admin,worker,web,redis}.env (root 600) and redis-users.acl
# (Redis' uid 999, 400). Generated: Redis passwords, SESSION_PEPPER, FIELD_ENCRYPTION_KEY, VAPID key pair.
# Services a phase does not use yet (PROGRESS F31): on staging clearly marked placeholders that pass validation
# (MongoDB Atlas URIs — Phase 1, Turnstile = Cloudflare's always-pass test secret — Phase 1, Cloudinary API keys —
# Phase 3, Cloudflare purge token — Phase 3/8); on production they stay EMPTY, so production refuses to boot until
# the real values are filled in (review S-M2; env.ts also rejects the placeholders in production).
set -euo pipefail

DOMAIN=almasjids.com
ENVIRONMENT=${1:-}
FORCE=${2:-}
case "$ENVIRONMENT" in
  staging) prefix=-staging ;;
  production) prefix='' ;;
  *) echo "usage: make-env.sh <staging|production> [--force]" >&2; exit 2 ;;
esac
[ -z "$FORCE" ] || [ "$FORCE" = --force ] || { echo "unknown option: $FORCE" >&2; exit 2; }
[ "$(id -u)" -eq 0 ] || { echo "run as root (sudo)" >&2; exit 1; }
DIR=${MC_CONFIG_DIR:-/etc/masjid-connect/$ENVIRONMENT}
[ -d "$DIR" ] || { echo "$DIR missing — run provision.sh base first" >&2; exit 1; }

FILES=(api-public.env api-admin.env worker.env web.env redis.env redis-users.acl)
if [ "$FORCE" != --force ]; then
  for file in "${FILES[@]}"; do
    if [ -s "$DIR/$file" ]; then echo "$DIR/$file already has content — nothing changed (--force rewrites, keeping values)" >&2; exit 1; fi
  done
fi

umask 077
secret() { openssl rand 24 | base64 -w0 | tr '+/' '-_' | tr -d '='; } # URL-safe (goes into redis:// URLs)
key32() { openssl rand -base64 32; }
b64url() { base64 -w0 | tr '+/' '-_' | tr -d '='; }
old() { # <file> <NAME> — the value already set in an existing file (empty if none)
  if [ -f "$DIR/$1" ]; then sed -n "s/^$2=//p" "$DIR/$1" | head -n 1; fi
}
keep() { # <file> <NAME> <default> — existing value, else the default
  local value
  value=$(old "$1" "$2")
  printf '%s' "${value:-$3}"
}
redis_password() { # <env file> <NAME> <ACL user> — the password inside an existing redis:// URL, else a new one
  local value
  value=$(old "$1" "$2" | sed -nE "s#^rediss?://$3:([^@]+)@.*#\\1#p")
  printf '%s' "${value:-$(secret)}"
}

# VAPID key pair (P-256): public = uncompressed point (65 bytes), private = the 32-byte scalar, both base64url.
# Kept if the worker already has one — a new key would break every push subscription.
vapid_public=$(old worker.env VAPID_PUBLIC_KEY)
vapid_private=$(old worker.env VAPID_PRIVATE_KEY)
if [ -z "$vapid_public" ] || [ -z "$vapid_private" ]; then
  work=$(mktemp -d)
  trap 'rm -rf "$work"' EXIT
  openssl ecparam -name prime256v1 -genkey -noout -out "$work/vapid.pem"
  vapid_public=$(openssl ec -in "$work/vapid.pem" -pubout -outform DER 2>/dev/null | tail -c 65 | b64url)
  # SEC1 DER for P-256: 30 77 02 01 01 04 20 <32-byte private scalar> … → bytes 8–39.
  der_head=$(openssl ec -in "$work/vapid.pem" -outform DER 2>/dev/null | head -c 7 | od -An -tx1 | tr -d ' \n')
  [ "$der_head" = 30770201010420 ] || { echo "unexpected EC key encoding ($der_head)" >&2; exit 1; }
  vapid_private=$(openssl ec -in "$work/vapid.pem" -outform DER 2>/dev/null | head -c 39 | tail -c 32 | b64url)
fi

redis_public=$(redis_password api-public.env REDIS_URL_PUBLIC rl_public)
redis_admin=$(redis_password api-admin.env REDIS_URL_ADMIN admin)
redis_worker=$(redis_password worker.env REDIS_URL_WORKER worker)
redis_health=$(keep redis.env REDIS_HEALTH_PASSWORD "$(secret)")
encryption_key=$(keep api-admin.env FIELD_ENCRYPTION_KEY "$(key32)")
encryption_id=$(keep api-admin.env FIELD_ENCRYPTION_KEY_ID "${ENVIRONMENT}1")
encryption_old=$(old api-admin.env FIELD_ENCRYPTION_OLD_KEYS)
session_pepper=$(keep api-admin.env SESSION_PEPPER "$(key32)")
app_origin=https://app$prefix.$DOMAIN
admin_origin=https://admin$prefix.$DOMAIN
media_origin=https://media$prefix.$DOMAIN
if [ "$ENVIRONMENT" = production ]; then hold=1440 robots=all; else hold=10 robots='noindex, nofollow'; fi

# External services: real values once set; until then staging placeholders / production empty (see header).
external() { # <file> <NAME> <staging placeholder>
  if [ "$ENVIRONMENT" = production ]; then keep "$1" "$2" ''; else keep "$1" "$2" "$3"; fi
}
mongo_placeholder() { echo "mongodb+srv://$1:PHASE1-ATLAS-NOT-SET@not-set.invalid/"; }
turnstile_test=1x0000000000000000000000000000000AA # Cloudflare's documented always-pass test secret

common="NODE_ENV=production
APP_ENV=$ENVIRONMENT
LOG_LEVEL=info
MONGODB_DB_NAME=masjid_connect
APP_ORIGIN=$app_origin
ADMIN_ORIGIN=$admin_origin
MEDIA_ORIGIN=$media_origin
TRUSTED_PROXY_MODE=cloudflare"
encryption="FIELD_ENCRYPTION_KEY=$encryption_key
FIELD_ENCRYPTION_KEY_ID=$encryption_id${encryption_old:+
FIELD_ENCRYPTION_OLD_KEYS=$encryption_old}"
cloudinary() { # <file>
  printf 'CLOUDINARY_CLOUD_NAME=%s\nCLOUDINARY_API_KEY=%s\nCLOUDINARY_API_SECRET=%s' \
    "$(keep "$1" CLOUDINARY_CLOUD_NAME g0ytozsb)" \
    "$(external "$1" CLOUDINARY_API_KEY 000000)" \
    "$(external "$1" CLOUDINARY_API_SECRET PHASE3-cloudinary-not-set)"
}

# All values are computed before any file is written (a --force run reads the old files above).
api_public="$common
MONGODB_URI_PUBLIC=$(external api-public.env MONGODB_URI_PUBLIC "$(mongo_placeholder mc_public)")
REDIS_URL_PUBLIC=redis://rl_public:$redis_public@redis:6379
TURNSTILE_SECRET=$(external api-public.env TURNSTILE_SECRET "$turnstile_test")
PORT=8787"
api_admin="$common
$encryption
MONGODB_URI_ADMIN=$(external api-admin.env MONGODB_URI_ADMIN "$(mongo_placeholder mc_admin)")
REDIS_URL_ADMIN=redis://admin:$redis_admin@redis:6379
SESSION_PEPPER=$session_pepper
RP_ID=admin$prefix.$DOMAIN
$(cloudinary api-admin.env)
TURNSTILE_SECRET=$(external api-admin.env TURNSTILE_SECRET "$turnstile_test")
VAPID_PUBLIC_KEY=$vapid_public
PAYMENT_HOLD_MINUTES=$hold
PORT=8788"
worker="$common
$encryption
MONGODB_URI_SYSTEM=$(external worker.env MONGODB_URI_SYSTEM "$(mongo_placeholder mc_system)")
REDIS_URL_WORKER=redis://worker:$redis_worker@redis:6379
VAPID_PUBLIC_KEY=$vapid_public
VAPID_PRIVATE_KEY=$vapid_private
VAPID_SUBJECT=$(keep worker.env VAPID_SUBJECT "$app_origin")
$(cloudinary worker.env)
CF_API_TOKEN_PURGE=$(external worker.env CF_API_TOKEN_PURGE PHASE3-not-set)
CF_ZONE_ID=$(external worker.env CF_ZONE_ID 00000000000000000000000000000000)
PAYMENT_HOLD_MINUTES=$hold"
web="APP_HOST=app$prefix.$DOMAIN
ADMIN_HOST=admin$prefix.$DOMAIN
MEDIA_ORIGIN=$media_origin
CSP_CONNECT_EXTRA=$(old web.env CSP_CONNECT_EXTRA)
APP_ROBOTS=$robots
CADDY_TLS=origin"

write() { # <file> <header> <body>
  printf '# %s — %s. Generated by infra/vps/make-env.sh on %s. Never copy off the server.\n%s\n' \
    "$1" "$2" "$(date -u +%Y-%m-%d)" "$3" >"$DIR/$1.new"
  chown root:root "$DIR/$1.new"
  chmod 600 "$DIR/$1.new"
  mv "$DIR/$1.new" "$DIR/$1"
}
write api-public.env "api-public ($ENVIRONMENT)" "$api_public"
write api-admin.env "api-admin ($ENVIRONMENT)" "$api_admin"
write worker.env "worker ($ENVIRONMENT)" "$worker"
write web.env "web / Caddy ($ENVIRONMENT)" "$web"
write redis.env "redis healthcheck ($ENVIRONMENT)" "REDIS_HEALTH_PASSWORD=$redis_health"

# Same ACL as local development (scripts/setup-local.mjs) without the test user: default user off, one user per
# process, dangerous/admin commands off (INFO re-allowed for ioredis/BullMQ), `health` may only PING.
safe='+@all -@dangerous -@admin +info'
cat >"$DIR/redis-users.acl.new" <<EOF
user default off
user rl_public on >$redis_public resetchannels ~rl:pub:* $safe
user admin on >$redis_admin resetchannels ~rl:adm:* ~chal:* ~bull:* &bull:* $safe
user worker on >$redis_worker resetchannels ~bull:* ~push:* ~alert:* &bull:* $safe
user health on >$redis_health resetkeys resetchannels -@all +ping
EOF
chown 999:1000 "$DIR/redis-users.acl.new" # the Redis container's user (docker-compose.vps.yml)
chmod 400 "$DIR/redis-users.acl.new"
mv -f "$DIR/redis-users.acl.new" "$DIR/redis-users.acl"

echo "make-env: wrote ${FILES[*]} in $DIR"
echo "Public values for GitHub → Settings → Environments → $ENVIRONMENT → Variables (not secrets):"
echo "  VITE_PUBLIC_VAPID_PUBLIC_KEY=$vapid_public"
echo "  VITE_PUBLIC_APP_ORIGIN=$app_origin"
echo "  VITE_PUBLIC_MEDIA_ORIGIN=$media_origin"
if [ "$ENVIRONMENT" = production ]; then
  echo "Still EMPTY until the owner fills them (production refuses to boot without them): MongoDB URIs,"
  echo "  TURNSTILE_SECRET, CLOUDINARY_API_KEY/SECRET, CF_API_TOKEN_PURGE, CF_ZONE_ID (PROGRESS F31)."
else
  echo "Placeholders to replace later (PROGRESS F31): MongoDB URIs (Phase 1), TURNSTILE_SECRET (Phase 1),"
  echo "  CLOUDINARY_API_KEY/SECRET (Phase 3), CF_API_TOKEN_PURGE + CF_ZONE_ID (Phase 3/8)."
fi
