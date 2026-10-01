#!/usr/bin/env bash
# Install the support-chat smoke's self-hosted GitHub Actions runner on the operator's
# machine — SANDBOXED, because pretyflaco/galoy-mobile is a PUBLIC repo (F-M16-12).
#
# Usage (as the operator; the registration token is read from STDIN, never argv):
#   gh api -X POST repos/pretyflaco/galoy-mobile/actions/runners/registration-token -q .token \
#     | sudo bash scripts/support-chat-ci/install-runner.sh
#
# Prerequisite (done 2026-10-01): `useradd -m -s /bin/bash gh-runner; usermod -aG kvm gh-runner`
# — the user must NOT be in sudo / plugdev (USB → the operator's phone) / docker / adm.
#
# Layers (the in-workflow `if:` is NOT one of them — a fork PR brings its own workflow):
#   1. repo settings: fork-PR workflows need approval for ALL external contributors;
#      default GITHUB_TOKEN read-only (set via the API 2026-10-01);
#   2. the runner carries ONLY the label `supportchat-muscle` (--no-default-labels), so
#      upstream workflows with `runs-on: self-hosted` never land here;
#   3. systemd sandbox: every /home except the runner's own is invisible (the operator's
#      home is mode 755), private /tmp, no new privileges (no sudo/suid), read-only
#      /usr /boot /etc, lowered CPU/IO weight; /dev/kvm via the kvm group;
#   4. own adb server port (the job never talks to the operator's adb server/phone).
# Residual risk (accepted, operator 2026-10-01): jobs share the host network namespace,
# so an approved-but-malicious job could reach loopback services (dev relay :7777,
# adb :5037, …). Only code approved by the repo owner ever runs here.
set -euo pipefail

VERSION=2.337.0
SHA256=70920811a4f8ad4328818682bca5c6469c1c942fab52448868071d0063816613 # verified against the artifact 2026-10-01
URL=https://github.com/pretyflaco/galoy-mobile
NAME=muscle-supportchat
LABEL=supportchat-muscle
RUSER=gh-runner
RHOME=/home/$RUSER
DIR=$RHOME/actions-runner
UNIT=/etc/systemd/system/gh-runner-supportchat.service

[ "$(id -u)" = 0 ] || { echo "run with sudo" >&2; exit 1; }
TOKEN=$(head -c 200 | tr -d '\r\n ')
[ -n "$TOKEN" ] || { echo "no registration token on stdin" >&2; exit 1; }

echo "== user checks"
id "$RUSER" >/dev/null
groups=$(id -nG "$RUSER")
echo "$groups" | grep -qw kvm || { echo "$RUSER must be in the kvm group" >&2; exit 1; }
for g in sudo wheel admin plugdev docker adm lxd libvirt; do
  if echo "$groups" | grep -qw "$g"; then echo "$RUSER must NOT be in group $g" >&2; exit 1; fi
done
passwd -l "$RUSER" >/dev/null # never a password login (idempotent; "NP" would mean passwordless)
chmod 750 "$RHOME"

echo "== runner $VERSION (sha256-pinned)"
if [ ! -x "$DIR/config.sh" ]; then
  tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
  curl -sfL -o "$tmp/runner.tgz" "https://github.com/actions/runner/releases/download/v$VERSION/actions-runner-linux-x64-$VERSION.tar.gz"
  echo "$SHA256  $tmp/runner.tgz" | sha256sum -c -
  install -d -o "$RUSER" -g "$RUSER" -m 750 "$DIR"
  # root opens the verified tarball (its mktemp dir is 0700) and feeds it to tar running
  # as the runner user — the runner user never needs access to root's temp dir
  sudo -u "$RUSER" tar -xzf - -C "$DIR" < "$tmp/runner.tgz"
fi

echo "== register ($NAME, label $LABEL only)"
if [ ! -f "$DIR/.runner" ]; then
  # the token goes in via the environment (the runner reads ACTIONS_RUNNER_INPUT_*), not argv
  sudo -u "$RUSER" env ACTIONS_RUNNER_INPUT_TOKEN="$TOKEN" "$DIR/config.sh" --unattended \
    --url "$URL" --name "$NAME" --labels "$LABEL" --no-default-labels --work _work --replace
else
  echo "already registered ($(grep -o '"agentName": *"[^"]*"' "$DIR/.runner"))"
fi
unset TOKEN

echo "== sandboxed service"
cat > "$UNIT" <<EOF
# Installed by scripts/support-chat-ci/install-runner.sh (blink-support-product). F-M16-12.
[Unit]
Description=GitHub Actions runner $NAME (pretyflaco/galoy-mobile support-chat smoke), sandboxed
After=network-online.target nix-daemon.service
Wants=network-online.target

[Service]
User=$RUSER
Group=$RUSER
WorkingDirectory=$DIR
ExecStart=$DIR/run.sh
Restart=always
RestartSec=15
KillSignal=SIGTERM
TimeoutStopSec=5min
Environment=ANDROID_ADB_SERVER_PORT=5039
UMask=0077
# every /home but the runner's own is invisible (the operator's home is world-readable)
ProtectHome=tmpfs
BindPaths=$RHOME
PrivateTmp=true
NoNewPrivileges=true
ProtectSystem=full
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectKernelLogs=true
ProtectControlGroups=true
ProtectClock=true
ProtectHostname=true
RestrictSUIDSGID=true
LockPersonality=true
# keep the operator's desktop responsive while the emulator + Gradle run
CPUWeight=50
IOWeight=50
MemoryMax=24G
TasksMax=8192

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now gh-runner-supportchat.service
sleep 8
systemctl is-active gh-runner-supportchat.service

echo "== sandbox check (inside the runner's mount namespace)"
pid=$(systemctl show -p MainPID --value gh-runner-supportchat.service)
echo "/home as the runner sees it: $(nsenter -t "$pid" -m ls -A /home | tr '\n' ' ')"
nsenter -t "$pid" -m test -e /home/kasita && { echo "SANDBOX FAILURE: /home/kasita visible" >&2; exit 1; } || echo "operator home: invisible ✓"
echo "/tmp entries visible to the runner: $(nsenter -t "$pid" -m ls -A /tmp | wc -l) (private)"
echo "done — the runner should show Idle at $URL/settings/actions/runners"
