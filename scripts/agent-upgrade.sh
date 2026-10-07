#!/usr/bin/env bash
# One-time SSH upgrade for legacy agents without architecture/digest support.
set -Eeuo pipefail
umask 077
MODE=${1:?mode}
DIR=${2:?backup directory}
[[ "$DIR" =~ ^/opt/backups/nextpanel-agent/[a-zA-Z0-9_-]+$ ]] || exit 2
BIN=/usr/local/bin/nextpanel-agent
UNIT=nextpanel-agent-ssh-rollback
mkdir -p /opt/backups/nextpanel-agent
exec 9>/opt/backups/nextpanel-agent/upgrade.lock
flock -w 20 9

rollback() {
  [[ ! -e "$DIR/CONFIRMED" && -s "$DIR/agent.previous" ]] || return 0
  cp -p "$DIR/agent.previous" "$BIN.rollback"
  mv -f "$BIN.rollback" "$BIN"
  systemctl restart nextpanel-agent
  date -u +%FT%TZ > "$DIR/ROLLED_BACK"
}

case "$MODE" in
  rollback) rollback ;;
  confirm)
    test ! -e "$DIR/ROLLED_BACK"
    systemctl is-active --quiet nextpanel-agent
    date -u +%FT%TZ > "$DIR/CONFIRMED"
    systemctl stop "$UNIT.timer"
    ;;
  upgrade)
    CANDIDATE=${3:?candidate}
    DIGEST=${4:?sha256}
    VERSION=${5:?version}
    test ! -e "$DIR"
    [[ "$DIGEST" =~ ^[a-f0-9]{64}$ && "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || exit 2
    printf '%s  %s\n' "$DIGEST" "$CANDIDATE" | sha256sum -c -
    chmod 755 "$CANDIDATE"
    [[ $(timeout 5 "$CANDIDATE" --version) == "$VERSION" ]]
    systemctl is-active --quiet nextpanel-agent
    test -f "$BIN"
    test ! -L "$BIN"
    systemctl show nextpanel-agent -p ExecStart --value | grep -F "path=$BIN ;" >/dev/null
    mkdir -m 700 "$DIR"
    cp -p "$BIN" "$DIR/agent.previous"
    cp -p /etc/nextpanel/agent.json "$DIR/agent.json"
    cp -p /etc/systemd/system/nextpanel-agent.service "$DIR/agent.service"
    cp "$0" "$DIR/upgrade.sh"
    sha256sum "$BIN" /etc/nextpanel/agent.json > "$DIR/before.sha256"
    # The old binary need not understand --rollback. Supervise from a separate cgroup.
    systemd-run --collect --unit="$UNIT" --on-active=240s --timer-property=AccuracySec=1s \
      /bin/bash "$DIR/upgrade.sh" rollback "$DIR"
    trap 'rollback' ERR
    cp "$CANDIDATE" "$BIN.candidate"
    chmod 755 "$BIN.candidate"
    mv -f "$BIN.candidate" "$BIN"
    systemctl restart nextpanel-agent
    systemctl is-active --quiet nextpanel-agent
    ;;
  *) exit 2 ;;
esac
