#!/usr/bin/env bash
# Tests infra/vps/atlas-users.sh (PHASE_01 T1.1) against a mock Atlas Administration API — no Atlas account needed:
#   docker run --rm -v "$PWD/infra:/infra:ro" ubuntu:24.04 bash /infra/vps/test/atlas-users.test.sh
# Proves: token request uses the client credentials, every role from atlas-roles.json is created (then PATCHed on a
# re-run), users are scoped to the cluster, connection strings land only in the right env files (600 root, valid shape),
# the migrate env file gets its other required values, and no password or secret ever reaches the output.
# shellcheck disable=SC2016,SC2034 # check() conditions are single-quoted and eval'd after each run
set -uo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq >/dev/null && apt-get install -y -qq curl jq openssl python3 >/dev/null || exit 1

root=$(mktemp -d)
mkdir -p "$root/config"
for f in api-public api-admin worker; do printf 'APP_ENV=staging\nMONGODB_URI_X=keep\n' >"$root/config/$f.env"; done
chmod 600 "$root/config"/*.env

cat >"$root/mock.py" <<'PY'
import base64, json, os, sys
from http.server import BaseHTTPRequestHandler, HTTPServer
LOG = sys.argv[1]
roles, users = set(), set()
class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def body(self):
        n = int(self.headers.get('Content-Length') or 0)
        return self.rfile.read(n).decode() if n else ''
    def reply(self, code, obj):
        data = json.dumps(obj).encode()
        self.send_response(code); self.send_header('Content-Type', 'application/json'); self.end_headers(); self.wfile.write(data)
    def record(self, method, body):
        with open(LOG, 'a') as f: f.write(json.dumps({'method': method, 'path': self.path, 'auth': self.headers.get('Authorization', ''), 'accept': self.headers.get('Accept', ''), 'body': body}) + '\n')
    def do_POST(self):
        body = self.body(); self.record('POST', body)
        if self.path == '/api/oauth/token':
            ok = self.headers.get('Authorization') == 'Basic ' + base64.b64encode(b'client-1:s3cret-value').decode()
            return self.reply(200 if ok else 401, {'access_token': 'tok-123', 'expires_in': 3600, 'token_type': 'Bearer'})
        if self.headers.get('Authorization') != 'Bearer tok-123': return self.reply(401, {'detail': 'bad token'})
        doc = json.loads(body)
        if self.path.endswith('/customDBRoles/roles'):
            if doc['roleName'] in roles: return self.reply(409, {'detail': 'exists'})
            roles.add(doc['roleName']); return self.reply(200, doc)
        if self.path.endswith('/databaseUsers'):
            if doc['username'] in users: return self.reply(409, {'detail': 'exists'})
            users.add(doc['username']); return self.reply(201, {'username': doc['username']})
        self.reply(404, {})
    def do_PATCH(self):
        body = self.body(); self.record('PATCH', body); self.reply(200, {})
HTTPServer(('127.0.0.1', 9555), H).serve_forever()
PY
python3 "$root/mock.py" "$root/calls.log" &
sleep 1

run() {
  printf '%s\n' 0123456789abcdef01234567 mc-staging mc-staging.ab12cd.mongodb.net client-1 s3cret-value |
    MC_CONFIG_DIR="$root/config" MC_ATLAS_ROLES=/infra/mongo/atlas-roles.json MC_ATLAS_API=http://127.0.0.1:9555 \
      bash /infra/vps/atlas-users.sh staging >"$root/out" 2>&1
}
failures=0
check() { if eval "$2"; then echo "PASS  $1"; else echo "FAIL  $1"; sed 's/^/      /' "$root/out"; failures=$((failures + 1)); fi; }
val() { grep "^$2=" "$root/config/$1" | cut -d= -f2-; }
uri_re='^mongodb\+srv://mc_[a-z]+:[A-Za-z0-9]{40}@mc-staging\.ab12cd\.mongodb\.net/\?retryWrites=true&w=majority&appName='

run; got=$?
check "first run succeeds" '[ "$got" -eq 0 ]'
check "token requested with the client credentials (Basic auth)" 'head -n 1 "$root/calls.log" | jq -e ".path == \"/api/oauth/token\"" >/dev/null'
check "4 custom roles created, exactly as in atlas-roles.json" \
  '[ "$(jq -s "[.[] | select(.path | endswith(\"/customDBRoles/roles\")) | .body | fromjson] | sort_by(.roleName)" "$root/calls.log")" = "$(jq "[.users[].role] | sort_by(.roleName)" /infra/mongo/atlas-roles.json)" ]'
check "every Atlas call uses the bearer token and the versioned Accept header" \
  '[ "$(jq -s "[.[] | select(.path | startswith(\"/api/atlas/v2/\")) | select(.auth != \"Bearer tok-123\" or (.accept | test(\"vnd.atlas.2023-01-01\") | not))] | length" "$root/calls.log")" = 0 ]'
check "users: admin auth db, own custom role, scoped to the cluster" \
  '[ "$(jq -s "[.[] | select(.path | endswith(\"/databaseUsers\")) | .body | fromjson | select(.databaseName == \"admin\" and .roles == [{roleName: (.username + \"__masjid_connect\"), databaseName: \"admin\"}] and .scopes == [{name: \"mc-staging\", type: \"CLUSTER\"}])] | length" "$root/calls.log")" = 4 ]'
check "each process env file got only its own user's URI" \
  '[[ "$(val api-public.env MONGODB_URI_PUBLIC)" =~ $uri_re ]] && [[ "$(val api-admin.env MONGODB_URI_ADMIN)" =~ $uri_re ]] && [[ "$(val worker.env MONGODB_URI_SYSTEM)" =~ $uri_re ]] && [[ "$(val migrate.env MONGODB_URI_MIGRATOR)" =~ $uri_re ]] && ! grep -q MONGODB_URI_ADMIN "$root/config/api-public.env"'
check "URIs carry the right user" \
  '[[ "$(val api-public.env MONGODB_URI_PUBLIC)" == mongodb+srv://mc_public:* ]] && [[ "$(val worker.env MONGODB_URI_SYSTEM)" == mongodb+srv://mc_system:* ]]'
check "existing lines kept; env files 600" \
  '[ "$(val api-admin.env MONGODB_URI_X)" = keep ] && [ "$(stat -c %a "$root/config/api-admin.env")" = 600 ] && [ "$(stat -c %a "$root/config/migrate.env")" = 600 ]'
check "migrate.env has NODE_ENV, APP_ENV, MONGODB_DB_NAME" \
  '[ "$(val migrate.env NODE_ENV)" = production ] && [ "$(val migrate.env APP_ENV)" = staging ] && [ "$(val migrate.env MONGODB_DB_NAME)" = masjid_connect ]'
pw=$(val api-public.env MONGODB_URI_PUBLIC | sed -E 's#^mongodb\+srv://[^:]+:([^@]+)@.*#\1#')
check "no password, client secret or token in the output" '! grep -qF "$pw" "$root/out" && ! grep -qF s3cret-value "$root/out" && ! grep -qF tok-123 "$root/out"'
first=$(val api-public.env MONGODB_URI_PUBLIC)

: >"$root/calls.log"; run; got=$?
check "re-run: roles and users exist → PATCH, passwords rotated" \
  '[ "$got" -eq 0 ] && [ "$(grep -c "\"method\": \"PATCH\"" "$root/calls.log")" = 8 ] && [ "$(val api-public.env MONGODB_URI_PUBLIC)" != "$first" ] && [ "$(grep -c "^MONGODB_URI_PUBLIC=" "$root/config/api-public.env")" = 1 ]'

printf '%s\n' 0123456789abcdef01234567 mc-staging mc-staging.ab12cd.mongodb.net client-1 wrong |
  MC_CONFIG_DIR="$root/config" MC_ATLAS_ROLES=/infra/mongo/atlas-roles.json MC_ATLAS_API=http://127.0.0.1:9555 \
    bash /infra/vps/atlas-users.sh staging >"$root/out" 2>&1; got=$?
check "wrong client secret: stops before changing anything" '[ "$got" -ne 0 ] && [ "$(val api-public.env MONGODB_URI_PUBLIC)" != "" ]'

printf '%s\n' not-an-id | MC_CONFIG_DIR="$root/config" MC_ATLAS_ROLES=/infra/mongo/atlas-roles.json \
  bash /infra/vps/atlas-users.sh staging >"$root/out" 2>&1; got=$?
check "malformed project id refused" '[ "$got" -ne 0 ]'

echo "== $failures failure(s)"
[ "$failures" -eq 0 ]
