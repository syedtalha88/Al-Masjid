#!/usr/bin/env bash
# VPS provisioning (04 §12.2, DECISIONS #21, #27, #40, #42, #54–#56; PHASE_00 T0.14). Idempotent; run as root.
# Stages, so a mistake cannot lock the owner out:
#   provision.sh base --admin <name> --admin-key '<ssh-ed25519 …>'   packages, updates, NTP, admin user, SSH hardening
#                                                                    (SSH still open), Docker, ufw, fail2ban, dirs,
#                                                                    Cloudflare-only 443, systemd units, repo checkout
#   provision.sh wireguard                                           WireGuard server on wg0 (10.66.0.1/24, UDP 51820)
#   provision.sh wg-peer <name> <public-key> <10.66.0.N>             add a device (keys are generated on the device)
#   provision.sh lockdown                                            close public SSH — refuses unless THIS session
#                                                                    already arrives through the tunnel
# DRAFT 14 Oct 2026 — reviewed line by line with the owner before the first run (PHASE_00 T0.14).
set -euo pipefail

REPO_URL=https://github.com/syedtalha88/Al-Masjid.git
REPO_DIR=/opt/masjid-connect
ETC=/etc/masjid-connect
WG_NET=10.66.0
WG_PORT=51820
# Docker's apt signing key (https://docs.docker.com/engine/install/ubuntu/) — verified before it is trusted.
DOCKER_KEY_FPR=9DC858229FC7DD38854AE2D88D81803C0EBFCD88

say() { printf '\n== %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
[ "$(id -u)" -eq 0 ] || die "run as root (sudo)"
grep -q 'VERSION_ID="24.04"' /etc/os-release || die "expected Ubuntu 24.04"

base() {
  local admin='' key=''
  while [ $# -gt 0 ]; do
    case "$1" in
      --admin) admin=$2; shift 2 ;;
      --admin-key) key=$2; shift 2 ;;
      *) die "unknown option $1" ;;
    esac
  done
  [[ "$admin" =~ ^[a-z][a-z0-9-]{2,30}$ ]] && [ "$admin" != admin ] && [ "$admin" != ubuntu ] ||
    die "--admin: a non-default lower-case user name (04 §12.2)"
  [[ "$key" =~ ^ssh-ed25519\ [A-Za-z0-9+/=]+(\ .*)?$ ]] || die "--admin-key: an ssh-ed25519 public key"

  say "packages"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl gnupg ufw fail2ban unattended-upgrades jq ipset iptables \
    wireguard-tools age git >/dev/null

  say "automatic security updates (reboot window 03:30 IST = 22:00 UTC) and NTP (CERT-In)"
  cat >/etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
  cat >/etc/apt/apt.conf.d/52masjid-connect <<'EOF'
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "22:00";
EOF
  timedatectl set-ntp true

  say "admin user $admin (key only; set a sudo password with: passwd $admin)"
  id "$admin" >/dev/null 2>&1 || adduser --disabled-password --gecos '' "$admin" >/dev/null
  usermod -aG sudo "$admin"
  install -d -m 700 -o "$admin" -g "$admin" "/home/$admin/.ssh"
  grep -qxF "$key" "/home/$admin/.ssh/authorized_keys" 2>/dev/null || printf '%s\n' "$key" >>"/home/$admin/.ssh/authorized_keys"
  chown "$admin:$admin" "/home/$admin/.ssh/authorized_keys"
  chmod 600 "/home/$admin/.ssh/authorized_keys"

  say "SSH hardening (port 22 stays reachable until 'lockdown')"
  cat >/etc/ssh/sshd_config.d/10-masjid-connect.conf <<EOF
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
X11Forwarding no
MaxAuthTries 3
AllowUsers $admin
EOF
  sshd -t || die "sshd configuration invalid — nothing reloaded"
  systemctl reload ssh
  echo "Keep this session open and test 'ssh $admin@<server>' in a second terminal before closing it."

  say "Docker Engine + Compose (official repository, key fingerprint checked)"
  install -d -m 755 /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  gpg --show-keys --with-colons /etc/apt/keyrings/docker.asc | grep -q "^fpr:::::::::$DOCKER_KEY_FPR:" ||
    die "Docker apt key fingerprint mismatch"
  chmod 644 /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu noble stable" \
    >/etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin >/dev/null
  cat >/etc/docker/daemon.json <<'EOF'
{
  "live-restore": true,
  "no-new-privileges": true,
  "log-driver": "local",
  "log-opts": { "max-size": "10m", "max-file": "5" }
}
EOF
  systemctl restart docker

  say "firewall: default deny; SSH (temporarily) + WireGuard; 443 via DOCKER-USER, Cloudflare only"
  ufw default deny incoming >/dev/null
  ufw default allow outgoing >/dev/null
  ufw allow 22/tcp >/dev/null # removed by 'lockdown'
  ufw allow "$WG_PORT/udp" >/dev/null
  ufw --force enable >/dev/null

  say "fail2ban (sshd)"
  printf '[sshd]\nenabled = true\nmaxretry = 3\nbantime = 1h\n' >/etc/fail2ban/jail.d/sshd.local
  systemctl enable --now fail2ban >/dev/null
  systemctl restart fail2ban

  say "directories: secrets (root 700/600), state, log archive (700), repository checkout"
  install -d -m 755 "$ETC"
  for env in staging production; do
    install -d -m 700 "$ETC/$env" "$ETC/$env/certs" "/var/lib/masjid-connect/$env"
    for file in api-public api-admin worker web redis; do
      [ -e "$ETC/$env/$file.env" ] || install -m 600 /dev/null "$ETC/$env/$file.env"
    done
    if [ ! -e "$ETC/$env/redis-users.acl" ]; then install -m 400 /dev/null "$ETC/$env/redis-users.acl"; fi
    chown 999:1000 "$ETC/$env/redis-users.acl" # read by the Redis container's own user (F29)
  done
  install -d -m 700 /var/log/masjid-connect /var/log/masjid-connect/archive
  [ -d "$REPO_DIR/.git" ] || git clone --quiet "$REPO_URL" "$REPO_DIR"

  say "Cloudflare-only 443 + systemd units (deploy, Cloudflare refresh, firewall at boot, log archive)"
  bash "$REPO_DIR/infra/vps/cloudflare-ips.sh"
  install -m 644 "$REPO_DIR"/infra/vps/systemd/*.service "$REPO_DIR"/infra/vps/systemd/*.timer /etc/systemd/system/
  systemctl daemon-reload
  systemctl enable --now mc-docker-user-firewall.service mc-cloudflare-ips.timer mc-log-archive.timer >/dev/null
  echo "The deploy timer is enabled per environment once its env files and signing key exist:"
  echo "  systemctl enable --now mc-deploy@staging.timer"
}

wireguard() {
  say "WireGuard server wg0 ($WG_NET.1/24, UDP $WG_PORT)"
  install -d -m 700 /etc/wireguard
  [ -s /etc/wireguard/wg0.key ] || (umask 077 && wg genkey >/etc/wireguard/wg0.key)
  if [ ! -e /etc/wireguard/wg0.conf ]; then
    umask 077
    printf '[Interface]\nAddress = %s.1/24\nListenPort = %s\nPrivateKey = %s\n' \
      "$WG_NET" "$WG_PORT" "$(cat /etc/wireguard/wg0.key)" >/etc/wireguard/wg0.conf
  fi
  systemctl enable --now wg-quick@wg0 >/dev/null
  echo "Server public key (put it in each device's WireGuard config): $(wg pubkey </etc/wireguard/wg0.key)"
}

wg_peer() {
  local name=${1:-} pub=${2:-} ip=${3:-}
  [[ "$name" =~ ^[a-z0-9-]{2,30}$ ]] || die "peer name: lower-case letters, digits, dashes"
  [[ "$pub" =~ ^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw480]=$ ]] || die "not a WireGuard public key"
  [[ "$ip" =~ ^${WG_NET//./\\.}\.([2-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-4])$ ]] || die "peer address must be $WG_NET.2–254"
  grep -qF "$pub" /etc/wireguard/wg0.conf ||
    printf '\n# %s\n[Peer]\nPublicKey = %s\nAllowedIPs = %s/32\n' "$name" "$pub" "$ip" >>/etc/wireguard/wg0.conf
  wg syncconf wg0 <(wg-quick strip wg0)
  echo "peer $name ($ip) added"
}

lockdown() {
  local client=${SSH_CONNECTION%% *}
  [[ "$client" == "$WG_NET".* ]] ||
    die "this SSH session comes from '$client', not through WireGuard ($WG_NET.x) — connect via the tunnel first"
  say "SSH only through WireGuard"
  ufw allow in on wg0 to any port 22 proto tcp >/dev/null
  ufw delete allow 22/tcp >/dev/null || true
  ufw status verbose
}

stage=${1:-}
shift || true
case "$stage" in
  base) base "$@" ;;
  wireguard) wireguard ;;
  wg-peer) wg_peer "$@" ;;
  lockdown) lockdown ;;
  *) die "usage: provision.sh base|wireguard|wg-peer|lockdown (see the header)" ;;
esac
