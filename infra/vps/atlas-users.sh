#!/usr/bin/env bash
# Atlas database users for one environment (02 §4.3, PHASE_01 T1.1, DECISIONS #60). Run ONCE per environment on the
# VPS as root, by the owner, with a temporary Atlas service account (Project Owner on that project only):
#   sudo bash /usr/local/lib/masjid-connect/atlas-users.sh staging
# It asks for the project id, cluster name/host and the service account's client id + secret (not echoed, never
# stored), creates or updates the four custom roles from atlas-roles.json (generated from packages/db/src/roles.ts),
# creates or updates the four users with NEW random passwords generated here, and writes each connection string only
# into that process's env file (600 root). Nothing secret is printed. Afterwards: delete the service account in Atlas,
# then `deploy.sh <env> --restart`. Re-running rotates all four passwords.
set -euo pipefail

ENVIRONMENT=${1:-}
case "$ENVIRONMENT" in staging | production) ;; *) echo "usage: atlas-users.sh <staging|production>" >&2; exit 2 ;; esac
[ "$(id -u)" -eq 0 ] || { echo "run as root (sudo)" >&2; exit 1; }
LIB=${MC_LIB_DIR:-/usr/local/lib/masjid-connect}
CONFIG=${MC_CONFIG_DIR:-/etc/masjid-connect/$ENVIRONMENT}
ROLES=${MC_ATLAS_ROLES:-$LIB/mongo/atlas-roles.json}
API=${MC_ATLAS_API:-https://cloud.mongodb.com}
ACCEPT='Accept: application/vnd.atlas.2023-01-01+json'
for tool in curl jq openssl; do command -v "$tool" >/dev/null || { echo "missing $tool" >&2; exit 1; }; done
[ -r "$ROLES" ] || { echo "missing $ROLES — run provision.sh host <sha>" >&2; exit 1; }

say() { printf '== %s\n' "$*"; }
ask() { # <variable> <prompt> [secret]
  local value=''
  if [ "${3:-}" = secret ]; then read -r -s -p "$2: " value; echo; else read -r -p "$2: " value; fi
  [ -n "$value" ] || { echo "$1 is required" >&2; exit 1; }
  printf -v "$1" '%s' "$value"
}

ask GROUP_ID 'Atlas project id (Project Settings → Project ID, 24 hex characters)'
[[ "$GROUP_ID" =~ ^[0-9a-f]{24}$ ]] || { echo "not a project id" >&2; exit 1; }
ask CLUSTER 'Cluster name (e.g. mc-staging)'
ask HOST 'Cluster host (e.g. mc-staging.ab12cd.mongodb.net)'
[[ "$HOST" =~ ^[a-z0-9.-]+\.mongodb\.net$ ]] || { echo "not an Atlas host name" >&2; exit 1; }
ask CLIENT_ID 'Service account client id'
ask CLIENT_SECRET 'Service account client secret (not shown)' secret

# Short-lived token (1 h); the secret is passed through stdin, never on a command line (ps) or to disk.
TOKEN=$(printf 'grant_type=client_credentials' | curl -fsS -X POST "$API/api/oauth/token" \
  -H 'Accept: application/json' -H 'Content-Type: application/x-www-form-urlencoded' \
  -K <(printf 'user = "%s:%s"\n' "$CLIENT_ID" "$CLIENT_SECRET") --data-binary @- | jq -r .access_token)
unset CLIENT_SECRET
[ -n "$TOKEN" ] && [ "$TOKEN" != null ] || { echo "could not get an Atlas token (client id/secret, IP access list?)" >&2; exit 1; }

# api <method> <path> [json body] — prints the HTTP status; the response body goes to $resp.
resp=$(mktemp)
trap 'rm -f "$resp"' EXIT
api() {
  local args=(-sS -o "$resp" -w '%{http_code}' -X "$1" "$API/api/atlas/v2$2" -H "$ACCEPT"
    -K <(printf 'header = "Authorization: Bearer %s"\n' "$TOKEN"))
  if [ $# -ge 3 ]; then args+=(-H 'Content-Type: application/json' --data-binary @-); printf '%s' "$3" | curl "${args[@]}"
  else curl "${args[@]}"; fi
}
expect() { # <status> <allowed...>
  local got=$1; shift
  for ok in "$@"; do [ "$got" = "$ok" ] && return 0; done
  echo "Atlas API error $got: $(jq -r '.detail // .reason // .' "$resp" 2>/dev/null | head -c 300)" >&2
  exit 1
}

DATABASE=$(jq -r .database "$ROLES")
# Each process's env file and the variable holding its connection string.
declare -A ENV_FILE=([mc_public]=api-public.env [mc_admin]=api-admin.env [mc_system]=worker.env [mc_migrator]=migrate.env)
declare -A ENV_VAR=([mc_public]=MONGODB_URI_PUBLIC [mc_admin]=MONGODB_URI_ADMIN [mc_system]=MONGODB_URI_SYSTEM [mc_migrator]=MONGODB_URI_MIGRATOR)

# set_env <file> <NAME> <value>: replace or append one line, keep 600 root.
set_env() {
  local file=$1 name=$2 value=$3 tmp
  tmp=$(mktemp "$CONFIG/.env.XXXXXX")
  { grep -v "^$name=" "$file" 2>/dev/null || true; printf '%s=%s\n' "$name" "$value"; } >"$tmp"
  chmod 600 "$tmp" && chown root:root "$tmp" && mv "$tmp" "$file"
}

for user in $(jq -r '.users[].user' "$ROLES"); do
  role=$(jq -c --arg u "$user" '.users[] | select(.user == $u) | .role' "$ROLES")
  role_name=$(jq -r .roleName <<<"$role")
  say "role $role_name"
  status=$(api POST "/groups/$GROUP_ID/customDBRoles/roles" "$role")
  if [ "$status" = 409 ]; then
    status=$(api PATCH "/groups/$GROUP_ID/customDBRoles/roles/$role_name" "$(jq -c 'del(.roleName)' <<<"$role")")
  fi
  expect "$status" 200 201 202

  say "user $user"
  password=$(openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c 40)
  body=$(jq -cn --arg u "$user" --arg p "$password" --arg r "$role_name" --arg c "$CLUSTER" \
    '{databaseName: "admin", username: $u, password: $p, roles: [{roleName: $r, databaseName: "admin"}],
      scopes: [{name: $c, type: "CLUSTER"}]}')
  status=$(api POST "/groups/$GROUP_ID/databaseUsers" "$body")
  if [ "$status" = 409 ]; then
    status=$(api PATCH "/groups/$GROUP_ID/databaseUsers/admin/$user" "$(jq -c 'del(.databaseName, .username)' <<<"$body")")
  fi
  expect "$status" 200 201 202

  file="$CONFIG/${ENV_FILE[$user]}"
  set_env "$file" "${ENV_VAR[$user]}" \
    "mongodb+srv://$user:$password@$HOST/?retryWrites=true&w=majority&appName=${ENV_FILE[$user]%.env}"
  if [ "$user" = mc_migrator ]; then
    set_env "$file" NODE_ENV production
    set_env "$file" APP_ENV "$ENVIRONMENT"
    set_env "$file" MONGODB_DB_NAME "$DATABASE"
  fi
  unset password body
  echo "   connection string written to $file (not shown)"
done

say "done — now delete the service account in Atlas, then: sudo $LIB/deploy.sh $ENVIRONMENT --restart"
