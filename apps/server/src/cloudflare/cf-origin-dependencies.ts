import type { NodeSSH } from 'node-ssh';
import { remoteExec } from '../resources/remote-exec';
import { quote } from '../resources/remote-inventory';
import { originFirewall } from './cf-origin-firewall';

// No global rules are loaded. A new-package-only transaction is guarded against
// service activation; an existing/broken installation is never replaced.
export const NFT_BOOTSTRAP_SCRIPT = String.raw`set -Eeuo pipefail
umask 077
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export LC_ALL=C DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=l NEEDRESTART_SUSPEND=1
test "$(id -u)" = 0
. /etc/os-release
case "$ID" in debian|ubuntu) ;; *) echo NP_UNSUPPORTED_PACKAGE_MANAGER; exit 1;; esac
command -v apt-get >/dev/null
command -v systemctl >/dev/null
test -z "$(dpkg --audit)"
test "$(dpkg-query -W -f='$'"{db:Status-Abbrev}" nftables 2>/dev/null || true)" != 'ii '
test "$(systemctl is-active nftables.service || true)" != active
case "$(systemctl is-enabled nftables.service 2>/dev/null || true)" in disabled|not-found) ;; *) echo NP_EXISTING_FIREWALL_SERVICE; exit 1;; esac
for p in /run/systemd/system/nftables.service /etc/systemd/system/nftables.service; do
 test ! -e "$p" && test ! -L "$p"
done
test ! -L /opt/backups/nextpanel
mkdir -p -m 700 /opt/backups/nextpanel
root=$(mktemp -d /opt/backups/nextpanel/nftables-bootstrap-XXXXXX)
echo "NP_BACKUP=$root"
mkdir -m 700 "$root/packages" "$root/packages/partial" "$root/extracted"
dpkg-query -W > "$root/packages-before.txt"
systemctl show nftables.service -p ActiveState -p UnitFileState > "$root/service-before.txt"
apt-get -o Acquire::Retries=1 -o Acquire::http::Timeout=20 -o Acquire::https::Timeout=20 update > "$root/update.log" 2>&1
apt-get -s --no-install-recommends --no-upgrade install nftables > "$root/plan.txt"
grep -Eq '^0 upgraded, [1-9][0-9]* newly installed, 0 to remove' "$root/plan.txt"
apt-get -y --download-only --no-install-recommends --no-upgrade -o Dir::Cache::archives="$root/packages" install nftables > "$root/download.log" 2>&1
for deb in "$root"/packages/*.deb; do
 name=$(dpkg-deb -f "$deb" Package)
 case "$name" in nftables|libnftables1|libnftnl11|libmnl0|libjansson4|libedit2|libgmp10|libreadline8|libreadline8t64|libtinfo6|libxtables12) ;; *) echo NP_UNEXPECTED_DEPENDENCY; exit 1;; esac
 test "$(dpkg-query -W -f='$'"{db:Status-Abbrev}" "$name" 2>/dev/null || true)" != 'ii '
 dpkg-deb -x "$deb" "$root/extracted"
done
sha256sum "$root"/packages/*.deb > "$root/package-checksums.txt"
nft=$(find "$root/extracted" -type f -name nft)
test -n "$nft"
libs=$(find "$root/extracted" -type f -name '*.so*' -exec dirname {} \; | sort -u | paste -sd: -)
LD_LIBRARY_PATH="$libs" "$nft" -s list ruleset > "$root/firewall-before.nft"
masked=false
cleanup() {
 if test "$masked" = true; then
  systemctl disable nftables.service >/dev/null 2>&1 || true
  if test "$(readlink /run/systemd/system/nftables.service 2>/dev/null || true)" = /dev/null; then
   systemctl unmask --runtime nftables.service >/dev/null
  fi
 fi
}
trap cleanup EXIT
systemctl mask --runtime nftables.service >/dev/null
masked=true
sha256sum -c "$root/package-checksums.txt" >/dev/null
apt-get -y --no-download --no-remove --no-install-recommends --no-upgrade -o DPkg::Lock::Timeout=20 -o Dir::Cache::archives="$root/packages" install "$root"/packages/*.deb > "$root/install.log" 2>&1
cleanup
masked=false
nft -s list ruleset > "$root/firewall-after.nft"
cmp "$root/firewall-before.nft" "$root/firewall-after.nft"
test "$(systemctl is-active nftables.service || true)" = inactive
test "$(systemctl is-enabled nftables.service || true)" = disabled
echo NP_NFT_INSTALLED
`;

export async function ensureOriginNftables(ssh: NodeSSH, nodeId: string, port: number, ref: string) {
  const present = await remoteExec(ssh, 'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin; command -v nft');
  if (present.code !== 0) {
    const installed = await remoteExec(ssh, `printf '%s' ${quote(Buffer.from(NFT_BOOTSTRAP_SCRIPT).toString('base64'))} | base64 -d | timeout 240 bash`, 270000);
    if (installed.code !== 0) throw new Error('nftables auto-install refused or failed; requires root, Debian/Ubuntu repositories and a new-package-only plan; inspect /opt/backups/nextpanel/nftables-bootstrap-*; no cloud resources created');
  }
  await verifyNftCapabilities(ssh, nodeId, port, ref);
}

async function verifyNftCapabilities(ssh: NodeSSH, nodeId: string, port: number, ref: string) {
  const f = originFirewall(nodeId, port, ref);
  const check = await remoteExec(ssh, `export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin; ` +
    `nft list tables >/dev/null && printf '%s' ${quote(Buffer.from(f.config).toString('base64'))} | base64 -d | nft -c -f -`);
  if (check.code !== 0) throw new Error('Origin mapping requires usable nftables with inet table comments and CAP_NET_ADMIN; no cloud resources created');
}

/** Reject unsupported hosts while creation is still read-only. */
export async function preflightOriginHost(ssh: NodeSSH) {
  const root = await remoteExec(ssh, 'id -u');
  if (root.code !== 0 || root.stdout.trim() !== '0') throw new Error('Isolated origin preparation requires root SSH privileges');
  const present = await remoteExec(ssh, 'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin; command -v nft');
  if (present.code === 0) {
    await verifyNftCapabilities(ssh, 'preflight', 8443, `np_origin_${'0'.repeat(32)}`);
    return;
  }
  const platform = await remoteExec(ssh, 'set -eu; . /etc/os-release; printf "%s\\n%s\\n" "$ID" "$VERSION_ID"; uname -r; command -v apt-get >/dev/null; command -v systemctl >/dev/null');
  const [os, version, kernel] = platform.stdout.trim().split('\n');
  const match = /^(\d+)\.(\d+)/.exec(kernel ?? '');
  const kernelSupported = match && (Number(match[1]) > 5 || (Number(match[1]) === 5 && Number(match[2]) >= 10));
  if (platform.code !== 0 || !kernelSupported || !((os === 'debian' && Number(version) >= 11) || (os === 'ubuntu' && Number(version) >= 22.04))) {
    throw new Error('nftables is missing: automatic preparation requires Debian 11+/Ubuntu 22.04+ and Linux 5.10+; upgrade this host or install a compatible nftables manually; no resources created');
  }
}
