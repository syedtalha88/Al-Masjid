#!/usr/bin/env bash
# log-archive.sh — container + host-journal archive (05 §5, security reviews of 22 Oct 2026). Runs in a throw-away
# ubuntu:24.04 container (CI):
#   docker run --rm -v "$PWD/infra/vps:/vps:ro" ubuntu:24.04 bash /vps/test/log-archive.test.sh
# docker, journalctl and age are stubs: "age" copies its input, so the archives can be read back as plain text.
set -uo pipefail

root=$(mktemp -d)
stub="$root/bin"
mkdir -p "$stub"
export STUB_DIR="$root"

cat >"$stub/docker" <<'EOF'
#!/usr/bin/env bash
# ps -a --filter label=…project=<p> --format …  → the containers listed for <p> in $STUB_DIR/ps-<p>
# inspect -f {{.Name}} <ref>  → /<ref>      logs … <ref>  → one line naming the container
case "$1" in
  ps)
    for arg in "$@"; do
      case "$arg" in label=com.docker.compose.project=*) project=${arg#label=com.docker.compose.project=} ;; esac
    done
    cat "$STUB_DIR/ps-${project:-none}" 2>/dev/null || true
    ;;
  inspect) echo "/${*: -1}" ;;
  logs) echo "log line of ${*: -1}" ;;
esac
EOF
cat >"$stub/journalctl" <<'EOF'
#!/usr/bin/env bash
[ -z "${STUB_JOURNAL_FAIL:-}" ] || { echo "journalctl: --since= must be before --until=" >&2; exit 1; }
echo "journal $*"
EOF
cat >"$stub/age" <<'EOF'
#!/usr/bin/env bash
# age -r <recipient> -o <file>: copy stdin
while [ $# -gt 0 ]; do case "$1" in -o) out=$2; shift 2 ;; *) shift ;; esac; done
cat >"$out"
EOF
chmod +x "$stub"/*

echo "age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq" >"$root/pub"
arch="$root/archive"
run() {
  PATH="$stub:$PATH" MC_LOG_RECIPIENT="$root/pub" MC_LOG_ARCHIVE="$arch" MC_LOG_LOCK="$root/lock" \
    bash /vps/log-archive.sh "$@" >"$root/out" 2>&1
}
failures=0
check() { # <label> <condition>
  if eval "$2"; then echo "PASS  $1"; else echo "FAIL  $1"; sed 's/^/      /' "$root/out"; failures=$((failures + 1)); fi
}
plain() { zcat "$@" 2>/dev/null; }

# mc-staging: two services, one one-off (True), one container with no / an unexpected label value.
cat >"$root/ps-mc-staging" <<'EOF'
mc-staging-api-public-1 False
mc-staging-api-admin-run-1a2b True
mc-staging-web-1
mc-staging-worker-1 false
EOF
old="$arch/2025-01-01"
mkdir -p "$old" && touch -d '2025-01-01' "$old"

run; got=$?
check "hourly run succeeds" '[ "$got" -eq 0 ]'
check "service containers archived; a one-off (label True) is skipped" \
  '[ -n "$(ls "$arch"/20*/mc-staging-api-public-1-* 2>/dev/null)" ] && [ -z "$(ls "$arch"/20*/mc-staging-api-admin-run-* 2>/dev/null)" ]'
check "no label or an unexpected value is still archived (fails open towards the archive)" \
  '[ -n "$(ls "$arch"/20*/mc-staging-web-1-* 2>/dev/null)" ] && [ -n "$(ls "$arch"/20*/mc-staging-worker-1-* 2>/dev/null)" ]'
check "the host journal is archived; the first run has no --since" \
  'plain "$arch"/20*/_host-journal-* | grep -q -- "--until" && ! plain "$arch"/20*/_host-journal-* | grep -q -- "--since"'
check "day folders older than 200 days are deleted" '[ ! -e "$old" ]'
first_state=$(cat "$arch/.state/_host-journal")

sleep 1
STUB_JOURNAL_FAIL=1 run; got=$?
check "a failing journal step fails the run, keeps its state and leaves no partial file" \
  '[ "$got" -eq 1 ] && [ "$(cat "$arch/.state/_host-journal")" = "$first_state" ] && [ "$(ls "$arch"/20*/_host-journal-* | wc -l)" -eq 1 ] && grep -q "state kept" "$root/out"'
mkdir -p "$old" && touch -d '2025-01-01' "$old"
STUB_JOURNAL_FAIL=1 run
check "retention still runs when the journal step fails" '[ ! -e "$old" ]'

sleep 1
run; got=$?
check "the next run continues from the kept state" \
  '[ "$got" -eq 0 ] && plain "$(ls "$arch"/20*/_host-journal-* | tail -n 1)" | grep -qF -- "--since $first_state"'

run --container mc-staging-api-public-1; got=$?
check "--container (deploy.sh) archives just that container, not the journal" \
  '[ "$got" -eq 0 ] && grep -q "1 container log(s)" "$root/out" && ! grep -q "host journal" "$root/out"'

echo "== $failures failure(s)"
[ "$failures" -eq 0 ]
