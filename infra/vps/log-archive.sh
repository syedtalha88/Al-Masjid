#!/usr/bin/env bash
# Container-log archive (DECISIONS #40; 05 CERT-In ≥ 180 days; review S-H3). Run as root:
#   log-archive.sh                         every container of mc-edge, mc-staging, mc-production (hourly timer)
#   log-archive.sh --container <id|name>…  just these — deploy.sh calls it right before it removes a container,
#                                          so no log line is lost when a deploy replaces containers
# Per container it archives everything since the last successful run (state file per container name), gzip →
# encrypted with `age` to the owner's public key (/etc/masjid-connect/log-archive.pub; the private key stays offline
# with the owner) → /var/log/masjid-connect/archive/<UTC date>/<container>-<HHMMSS>.log.gz.age (600). Day folders
# older than 200 days are deleted. Exit 3 = no archive key installed yet (PROGRESS O3).
set -euo pipefail

RECIPIENT_FILE=${MC_LOG_RECIPIENT:-/etc/masjid-connect/log-archive.pub}
ARCHIVE=${MC_LOG_ARCHIVE:-/var/log/masjid-connect/archive}
KEEP_DAYS=200

[ -s "$RECIPIENT_FILE" ] || { echo "log-archive: no age recipient at $RECIPIENT_FILE (owner's public key)" >&2; exit 3; }
recipient=$(head -n 1 "$RECIPIENT_FILE")
[[ "$recipient" =~ ^age1[0-9a-z]{58}$ ]] || { echo "log-archive: $RECIPIENT_FILE is not an age public key" >&2; exit 1; }

if [ "${1:-}" = --container ]; then
  shift
  containers=("$@")
else
  containers=()
  for project in mc-edge mc-staging mc-production; do
    while read -r container; do
      [ -n "$container" ] && containers+=("$container")
    done < <(docker ps -a --filter "label=com.docker.compose.project=$project" --format '{{.Names}}')
  done
fi

umask 077
install -d -m 700 "$ARCHIVE" "$ARCHIVE/.state"
# One run at a time: the hourly timer and a deploy's --container call must not read the same "since" state and write
# overlapping archives (re-review L2). Waits up to 10 minutes for the other run.
exec 9>"${MC_LOG_LOCK:-$ARCHIVE/.lock}"
flock -w 600 9 || { echo "log-archive: another run holds the lock" >&2; exit 1; }
now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
target="$ARCHIVE/$(date -u +%Y-%m-%d)"
install -d -m 700 "$target"

count=0
for ref in "${containers[@]}"; do
  name=$(docker inspect -f '{{.Name}}' "$ref" 2>/dev/null | sed 's|^/||') || true
  [[ "$name" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ ]] || { echo "log-archive: skipping unknown container '$ref'" >&2; continue; }
  state="$ARCHIVE/.state/$name"
  since=()
  if [ -s "$state" ]; then since=(--since "$(cat "$state")"); fi
  # Never overwrite: two archives of one container in the same second get distinct names (re-review L2).
  out="$target/$name-$(date -u +%H%M%S).log.gz.age"
  n=1
  while [ -e "$out" ]; do
    out="$target/$name-$(date -u +%H%M%S)-$n.log.gz.age"
    n=$((n + 1))
  done
  docker logs "${since[@]}" --until "$now" --timestamps "$ref" 2>&1 | gzip -9 | age -r "$recipient" -o "$out"
  printf '%s\n' "$now" >"$state"
  count=$((count + 1))
done
echo "log-archive: $count container log(s) archived to $target"

# Retention: delete whole day folders past 200 days (≥ 180 required).
find "$ARCHIVE" -mindepth 1 -maxdepth 1 -type d -name '20*' -mtime +"$KEEP_DAYS" -print -exec rm -rf {} +
