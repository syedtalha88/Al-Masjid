#!/usr/bin/env bash
# VPS hardening checklist (04 §12.2, PHASE_00 T0.14) — READ-ONLY: it inspects, never changes anything.
# Run on the VPS as root:  sudo bash infra/vps/check.sh        (pnpm infra:check prints how)
# Output: one PASS / FAIL / WARN line per check, a summary, exit 1 when anything FAILs.
# Drafted 14 Oct 2026 before the server exists; reviewed and first run together with the owner in T0.14.
set -uo pipefail

ENV_ROOT=/etc/masjid-connect                 # per-environment env files (DECISIONS #42)
CF_IPS_FILE=$ENV_ROOT/cloudflare-ips.txt     # written by the weekly refresh timer (provision.sh)
LOG_ARCHIVE=/var/log/masjid-connect/archive  # 200-day encrypted log archive (DECISIONS #40)
WG_PORT=${WG_PORT:-51820}                    # WireGuard UDP port (DECISIONS #27)

pass=0 fail=0 warn=0
ok()   { printf 'PASS  %s\n' "$1"; pass=$((pass + 1)); }
bad()  { printf 'FAIL  %s\n' "$1"; fail=$((fail + 1)); }
note() { printf 'WARN  %s\n' "$1"; warn=$((warn + 1)); }
check() { if eval "$2" >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi; } # <label> <command>
has() { command -v "$1" >/dev/null 2>&1; }

echo "== Masjid Connect VPS hardening check — $(hostname) — $(date -u +%Y-%m-%dT%H:%MZ)"
[ "$(id -u)" -eq 0 ] || note "not running as root: some checks cannot read their files"

# --- OS & updates -------------------------------------------------------------------------------------
check "OS is Ubuntu 24.04 LTS" "grep -q 'VERSION_ID=\"24.04\"' /etc/os-release"
check "unattended-upgrades enabled" "grep -q 'Unattended-Upgrade \"1\"' /etc/apt/apt.conf.d/20auto-upgrades"
check "clock synchronised by NTP (CERT-In)" "timedatectl show -p NTPSynchronized --value | grep -qx yes"

# --- SSH (keys only, no root, only through WireGuard) -------------------------------------------------
if has sshd; then
  sshd_cfg=$(sshd -T 2>/dev/null)
  sshd_is() { grep -qix "$1 $2" <<<"$sshd_cfg"; }
  if sshd_is permitrootlogin no; then ok "SSH: root login disabled"; else bad "SSH: root login disabled"; fi
  if sshd_is passwordauthentication no; then ok "SSH: password login disabled"; else bad "SSH: password login disabled"; fi
  if sshd_is kbdinteractiveauthentication no; then ok "SSH: keyboard-interactive disabled"; else bad "SSH: keyboard-interactive disabled"; fi
  if sshd_is x11forwarding no; then ok "SSH: X11 forwarding off"; else bad "SSH: X11 forwarding off"; fi
  if grep -qi '^allowusers ' <<<"$sshd_cfg"; then ok "SSH: AllowUsers set"; else bad "SSH: AllowUsers set"; fi
  max_tries=$(awk 'tolower($1)=="maxauthtries"{print $2}' <<<"$sshd_cfg")
  if [ "${max_tries:-6}" -le 3 ]; then ok "SSH: MaxAuthTries <= 3"; else bad "SSH: MaxAuthTries <= 3 (is ${max_tries:-6})"; fi
else
  bad "SSH: sshd not found"
fi

# --- Firewall ------------------------------------------------------------------------------------------
if has ufw; then
  ufw_status=$(ufw status verbose 2>/dev/null)
  if grep -q '^Status: active' <<<"$ufw_status"; then ok "firewall: ufw active"; else bad "firewall: ufw active"; fi
  if grep -q 'Default: deny (incoming)' <<<"$ufw_status"; then ok "firewall: default deny incoming"; else bad "firewall: default deny incoming"; fi
  if grep -Eq '^(22|22/tcp|OpenSSH)( \(v6\))?[[:space:]]+ALLOW IN[[:space:]]+Anywhere' <<<"$ufw_status"; then
    bad "firewall: SSH must not be open to Anywhere (WireGuard only — DECISIONS #27)"
  else
    ok "firewall: SSH not open to Anywhere"
  fi
  if grep -Eq "^${WG_PORT}/udp[[:space:]]+ALLOW IN" <<<"$ufw_status"; then ok "firewall: WireGuard ${WG_PORT}/udp allowed"; else bad "firewall: WireGuard ${WG_PORT}/udp allowed"; fi
else
  bad "firewall: ufw not installed"
fi
if [ -s "$CF_IPS_FILE" ]; then
  ok "Cloudflare IP list present ($(wc -l <"$CF_IPS_FILE") ranges)"
  age_days=$(( ($(date +%s) - $(stat -c %Y "$CF_IPS_FILE")) / 86400 ))
  if [ "$age_days" -le 8 ]; then ok "Cloudflare IP list refreshed within 8 days"; else bad "Cloudflare IP list refreshed within 8 days (${age_days} days old)"; fi
else
  bad "Cloudflare IP list present ($CF_IPS_FILE)"
fi
if has iptables; then
  # Docker bypasses ufw; DOCKER-USER must drop non-Cloudflare traffic to host port 443 (04 §12.2). The rule matches
  # the ORIGINAL destination port (conntrack) because DOCKER-USER sees packets after Docker's DNAT.
  # (cloudflare-ips.sh writes exactly this rule.)
  cf_rule='-i [^ ]+ -p tcp -m conntrack --ctstate NEW --ctorigdstport 443 -m set ! --match-set cloudflare4 src .*-j DROP'
  if iptables -S DOCKER-USER 2>/dev/null | grep -Eq -- "$cf_rule"; then
    ok "firewall: DOCKER-USER drops non-Cloudflare IPv4 to 443"
  else
    bad "firewall: DOCKER-USER drops non-Cloudflare IPv4 to 443"
  fi
  if ip6tables -S DOCKER-USER 2>/dev/null | grep -Eq -- "${cf_rule/cloudflare4/cloudflare6}"; then
    ok "firewall: DOCKER-USER drops non-Cloudflare IPv6 to 443"
  else
    bad "firewall: DOCKER-USER drops non-Cloudflare IPv6 to 443"
  fi
else
  bad "firewall: iptables not available to inspect DOCKER-USER"
fi

# --- What listens on public interfaces ------------------------------------------------------------------
if has ss; then
  public=$(ss -H -tuln 2>/dev/null | awk '{print $1, $5}' |
    grep -Ev ' (127\.[0-9.]+|\[::1\]|::1|10\.[0-9.]+|\[fd[0-9a-f:]*\])(%[a-z0-9]+)?:[0-9]+$' || true)
  # sshd keeps listening on all addresses after `lockdown`; whether :22 is reachable is ufw's job, checked above
  # ("SSH not open to Anywhere"), so :22 is not an unexpected listener here (review S-L3).
  unexpected=$(awk -v wg=":${WG_PORT}\$" '
    $1=="tcp" && ($2 ~ /:443$/ || $2 ~ /:80$/ || $2 ~ /:22$/) {next}
    $1=="udp" && $2 ~ wg {next}
    {print}' <<<"$public")
  if [ -z "$unexpected" ]; then ok "only 443/80 (TCP) and WireGuard (UDP) listen publicly"; else bad "unexpected public listeners: $(tr '\n' ' ' <<<"$unexpected")"; fi
else
  bad "ss not available"
fi

# --- Intrusion protection -------------------------------------------------------------------------------
check "fail2ban running" "systemctl is-active --quiet fail2ban"
check "fail2ban sshd jail enabled" "fail2ban-client status sshd"
check "WireGuard interface up (wg0)" "ip link show wg0"

# --- Docker daemon --------------------------------------------------------------------------------------
if has docker; then
  daemon=/etc/docker/daemon.json
  check "Docker: live-restore" "grep -Eq '\"live-restore\"[[:space:]]*:[[:space:]]*true' $daemon"
  check "Docker: no-new-privileges by default" "grep -Eq '\"no-new-privileges\"[[:space:]]*:[[:space:]]*true' $daemon"
  check "Docker: default log driver 'local' (rotated)" "grep -Eq '\"log-driver\"[[:space:]]*:[[:space:]]*\"local\"' $daemon"
  if grep -q '"userns-remap"' "$daemon" 2>/dev/null; then ok "Docker: user-namespace remapping"; else note "Docker: no user-namespace remapping (04 §12.2: 'where compatible')"; fi

  # --- Every running container (04 §12.2) --------------------------------------------------------------
  ids=$(docker ps -q 2>/dev/null)
  if [ -z "$ids" ]; then note "no running containers to inspect"; fi
  for id in $ids; do
    name=$(docker inspect -f '{{.Name}}' "$id" | sed 's|^/||')
    user=$(docker inspect -f '{{.Config.User}}' "$id")
    readonly_fs=$(docker inspect -f '{{.HostConfig.ReadonlyRootfs}}' "$id")
    privileged=$(docker inspect -f '{{.HostConfig.Privileged}}' "$id")
    capdrop=$(docker inspect -f '{{.HostConfig.CapDrop}}' "$id")
    secopt=$(docker inspect -f '{{.HostConfig.SecurityOpt}}' "$id")
    memory=$(docker inspect -f '{{.HostConfig.Memory}}' "$id")
    health=$(docker inspect -f '{{if .Config.Healthcheck}}yes{{end}}' "$id")
    mounts=$(docker inspect -f '{{range .Mounts}}{{.Source}} {{end}}' "$id")
    case "$name" in
      *mongo*) : ;; # local dev stack only (Atlas in staging/production); the image drops privileges itself
      *)
        if [ -n "$user" ] && [ "$user" != "root" ] && [ "$user" != "0" ] && [ "$user" != "0:0" ]; then ok "$name: non-root user ($user)"; else bad "$name: non-root user"; fi
        if [ "$readonly_fs" = "true" ]; then ok "$name: read-only root filesystem"; else bad "$name: read-only root filesystem"; fi
        ;;
    esac
    if [ "$privileged" = "false" ]; then ok "$name: not privileged"; else bad "$name: not privileged"; fi
    if grep -q 'ALL' <<<"$capdrop"; then ok "$name: cap_drop ALL"; else bad "$name: cap_drop ALL"; fi
    if grep -q 'no-new-privileges' <<<"$secopt"; then ok "$name: no-new-privileges"; else bad "$name: no-new-privileges"; fi
    if [ "$memory" != "0" ]; then ok "$name: memory limit"; else bad "$name: memory limit"; fi
    if [ "$health" = "yes" ]; then ok "$name: healthcheck"; else bad "$name: healthcheck"; fi
    if grep -q 'docker.sock' <<<"$mounts"; then bad "$name: docker.sock mounted"; else ok "$name: no docker.sock mount"; fi
  done
else
  bad "Docker not installed"
fi

# --- Container egress (review S-H2): the Cloudflare-only rule must not block outbound HTTPS from the APIs ----------
if has docker; then
  for env in staging production; do
    api=$(docker ps -q --filter "label=com.docker.compose.project=mc-$env" \
      --filter "label=com.docker.compose.service=api-public" | head -n 1)
    [ -n "$api" ] || continue
    probe="fetch('https://api.cloudflare.com/client/v4/ips',{signal:AbortSignal.timeout(8000)}).then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
    check "$env: containers reach the internet over HTTPS (egress not blocked)" "docker exec $api /nodejs/bin/node -e \"$probe\""
  done
fi

# --- Secrets and logs on disk ---------------------------------------------------------------------------
found_env=0
for file in "$ENV_ROOT"/staging/*.env "$ENV_ROOT"/production/*.env; do
  [ -e "$file" ] || continue
  found_env=1
  mode=$(stat -c '%a %U' "$file")
  if [ "$mode" = "600 root" ]; then ok "env file $file is 600 root"; else bad "env file $file is 600 root (is $mode)"; fi
done
[ "$found_env" -eq 1 ] || bad "env files present under $ENV_ROOT/<environment>/"
if [ -d "$LOG_ARCHIVE" ]; then
  if [ "$(stat -c '%a' "$LOG_ARCHIVE")" = "700" ]; then ok "log archive directory is 700"; else bad "log archive directory is 700"; fi
else
  bad "log archive directory exists ($LOG_ARCHIVE)"
fi

echo "== $pass PASS · $fail FAIL · $warn WARN"
[ "$fail" -eq 0 ]
