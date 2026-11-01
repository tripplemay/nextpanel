import { randomUUID } from 'crypto';
import type { NodeSSH } from 'node-ssh';
import { quote } from '../../resources/remote-inventory';
import { remoteExec } from '../../resources/remote-exec';
import { CF_XHTTP_XRAY_VERSION } from './cf-xhttp';

export const CF_XHTTP_CORE_DIR = `/usr/local/lib/nextpanel/xray-${CF_XHTTP_XRAY_VERSION}`;
export const CF_XHTTP_CORE_BIN = `${CF_XHTTP_CORE_DIR}/xray`;
const reviewed = new RegExp(`^Xray\\s+v?${CF_XHTTP_XRAY_VERSION.replace(/\./g, '\\.')}(?:\\s|\\(|$)`);
const assets: Record<string, { name: string; sha256: string }> = {
  x86_64: { name: '64', sha256: '29ce535b56e207a406ffa1c2d4842dcc410be003eff8ec508bb732abc9f8e385' },
  aarch64: { name: 'arm64-v8a', sha256: 'b52d8263453fbd6f4747fd6a1ecf70cd43a664243615dc892ea4674c01b2b5ee' },
};

export async function preflightCfXhttpCore(ssh: NodeSSH) {
  const shared = await remoteExec(ssh, '/usr/local/bin/xray version 2>&1');
  if (shared.code === 0 && reviewed.test(shared.stdout)) return;
  const isolated = await remoteExec(ssh, `${quote(CF_XHTTP_CORE_BIN)} version 2>/dev/null`);
  if (isolated.code === 0 && reviewed.test(isolated.stdout)) return;
  const result = await remoteExec(ssh, 'set -eu; test "$(id -u)" = 0; command -v curl >/dev/null; command -v unzip >/dev/null; uname -m');
  if (result.code !== 0 || !assets[(result.stdout ?? '').trim()]) {
    throw new Error('Isolated Xray requires root, Linux x86_64/aarch64, curl and unzip; shared core unchanged');
  }
}

/** Use the reviewed core without upgrading or downgrading other nodes' shared binary. */
export async function ensureCfXhttpCore(ssh: NodeSSH, log: (message: string) => void = () => undefined) {
  const shared = await remoteExec(ssh, '/usr/local/bin/xray version 2>&1');
  if (shared.code === 0 && reviewed.test(shared.stdout)) return '/usr/local/bin/xray';
  const current = await remoteExec(ssh, `test ! -L /usr/local/lib/nextpanel && test ! -L ${quote(CF_XHTTP_CORE_DIR)} && test ! -L ${quote(CF_XHTTP_CORE_BIN)} && ${quote(CF_XHTTP_CORE_BIN)} version 2>/dev/null`);
  if (current.code === 0 && reviewed.test(current.stdout)) return CF_XHTTP_CORE_BIN;
  const arch = await remoteExec(ssh, 'uname -m');
  const asset = assets[(arch.stdout ?? '').trim()];
  if (arch.code !== 0 || !asset) throw new Error('CDN XHTTP supports Linux x86_64/aarch64; shared core unchanged');
  const stage = `/usr/local/lib/nextpanel/.xray-${randomUUID()}`;
  const url = `https://github.com/XTLS/Xray-core/releases/download/v${CF_XHTTP_XRAY_VERSION}/Xray-linux-${asset.name}.zip`;
  log(`Preparing isolated Xray ${CF_XHTTP_XRAY_VERSION}; shared core unchanged`);
  const result = await remoteExec(ssh, `set -eu; umask 077; ` +
    `test "$(id -u)" = 0; command -v curl >/dev/null; command -v unzip >/dev/null; ` +
    `test ! -L /usr/local/lib/nextpanel; mkdir -p /usr/local/lib/nextpanel; ` +
    `test ! -e ${quote(CF_XHTTP_CORE_DIR)}; test ! -L ${quote(CF_XHTTP_CORE_DIR)}; ` +
    `mkdir -m 0700 ${quote(stage)}; trap 'rm -rf -- ${stage}' EXIT HUP INT TERM; ` +
    `curl --proto '=https' --tlsv1.2 -fsSL --retry 2 --connect-timeout 15 --max-time 120 -o ${quote(stage + '/core.zip')} ${quote(url)}; ` +
    `printf '%s  %s\\n' '${asset.sha256}' ${quote(stage + '/core.zip')} | sha256sum -c - >/dev/null; ` +
    `unzip -oq ${quote(stage + '/core.zip')} xray -d ${quote(stage)}; chmod 0755 ${quote(stage + '/xray')}; ` +
    `${quote(stage + '/xray')} version | grep -Eq '^Xray[[:space:]]+v?26\\.2\\.6([[:space:]]|\\()'; ` +
    `rm -f ${quote(stage + '/core.zip')}; chmod 0755 ${quote(stage)}; mv -T ${quote(stage)} ${quote(CF_XHTTP_CORE_DIR)}`, 270000);
  if (result.code !== 0) throw new Error('Isolated Xray preparation failed; check curl/unzip, download access and existing version directory; shared core unchanged');
  const verified = await remoteExec(ssh, `${quote(CF_XHTTP_CORE_BIN)} version`);
  if (verified.code !== 0 || !reviewed.test(verified.stdout)) throw new Error('Isolated Xray version verification failed');
  return CF_XHTTP_CORE_BIN;
}

export function usageXrayBinary(execStart: string): string {
  const path = /(?:^|\{\s*)path=([^\s;]+)\s*;/.exec(execStart)?.[1];
  if (path !== '/usr/local/bin/xray' && path !== CF_XHTTP_CORE_BIN) throw new Error('UNEXPECTED_CORE_PATH');
  return path;
}
