#!/usr/bin/env bash
# Daily container-log archive (DECISIONS #40; 05 CERT-In ≥ 180 days). Run as root by mc-log-archive.timer.
# For every container of mc-staging, mc-production and mc-edge: the last 24 h of logs → gzip → encrypted with
# `age` to the owner's public key (/etc/masjid-connect/log-archive.pub — the private key stays with the owner,
# offline) → /var/log/masjid-connect/archive/<date>/ (600). Archives older than 200 days are deleted.
# DRAFT 14 Oct 2026 — first run with the owner in T0.14.
set -euo pipefail

RECIPIENT_FILE=${MC_LOG_RECIPIENT:-/etc/masjid-connect/log-archive.pub}
ARCHIVE=${MC_LOG_ARCHIVE:-/var/log/masjid-connect/archive}
KEEP_DAYS=200

[ -s "$RECIPIENT_FILE" ] || { echo "log-archive: no age recipient at $RECIPIENT_FILE (owner's public key)" >&2; exit 1; }
recipient=$(head -n 1 "$RECIPIENT_FILE")
[[ "$recipient" =~ ^age1[0-9a-z]{58}$ ]] || { echo "log-archive: $RECIPIENT_FILE is not an age public key" >&2; exit 1; }

day=$(date -u +%Y-%m-%d)
target="$ARCHIVE/$day"
install -d -m 700 "$target"
umask 077

count=0
for project in mc-edge mc-staging mc-production; do
  while read -r container; do
    [ -n "$container" ] || continue
    out="$target/$container.log.gz.age"
    [ -e "$out" ] && continue # already archived today
    docker logs --since 24h --timestamps "$container" 2>&1 | gzip -9 | age -r "$recipient" -o "$out"
    count=$((count + 1))
  done < <(docker ps -a --filter "label=com.docker.compose.project=$project" --format '{{.Names}}')
done
echo "log-archive: $count container log(s) archived to $target"

# Retention: delete whole day folders past 200 days (≥ 180 required).
find "$ARCHIVE" -mindepth 1 -maxdepth 1 -type d -mtime +"$KEEP_DAYS" -print -exec rm -rf {} +
