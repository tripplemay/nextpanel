import { createHash } from 'crypto';
import type { NodeSSH } from 'node-ssh';
import { CF_IP_RANGES } from '../subscriptions/cf-access.util';
import { quote } from '../resources/remote-inventory';
import { remoteExec } from '../resources/remote-exec';

export function originFirewall(nodeId: string, port: number, ref: string) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(nodeId) || !/^np_origin_[a-f0-9]{32}$/.test(ref)
    || !Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid origin firewall target');
  const table = `np_cf_${createHash('sha256').update(nodeId).digest('hex').slice(0, 16)}`;
  const base = `/etc/nextpanel/nodes/${nodeId}.cf`;
  const marker = `nextpanel:${ref}`;
  const config = `add table inet ${table}\nflush table inet ${table}\ntable inet ${table} {
 comment "${marker}"
 chain ingress {
  type filter hook input priority -10; policy accept;
  tcp dport ${port} ip saddr != { ${CF_IP_RANGES.filter(x => !x.includes(':')).join(', ')} } drop
  tcp dport ${port} ip6 saddr != { ${CF_IP_RANGES.filter(x => x.includes(':')).join(', ')} } drop
 }
}\n`;
  const guard = `#!/bin/sh
set -eu
command -v nft >/dev/null || { echo 'nftables is required for isolated CF origin ingress'; exit 1; }
nft list tables >/dev/null
if nft list table inet ${table} >/dev/null 2>&1; then
 nft list table inet ${table} | grep -Fq 'comment "${marker}"' || { echo 'Origin firewall ownership mismatch'; exit 1; }
fi
nft -c -f ${base}.nft
nft -f ${base}.nft
actual="$(nft -s list table inet ${table})"
printf '%s' "$actual" | sha256sum | cut -d ' ' -f 1 > ${base}.sha256
`;
  return { table, base, marker, config, guard };
}

export async function installOriginFirewall(ssh: NodeSSH, nodeId: string, port: number, ref: string) {
  const f = originFirewall(nodeId, port, ref);
  // Leave a restrictive guard on failure. Only verified teardown removes it.
  const result = await remoteExec(ssh, `set -eu; umask 077; command -v nft >/dev/null; test ! -L /etc/nextpanel/nodes; mkdir -p /etc/nextpanel/nodes; ` +
    `test ! -L ${quote(f.base + '.nft')}; test ! -L ${quote(f.base + '.sh')}; test ! -L ${quote(f.base + '.sha256')}; ` +
    `printf '%s' ${quote(Buffer.from(f.config).toString('base64'))} | base64 -d > ${quote(f.base + '.nft')}; ` +
    `printf '%s' ${quote(Buffer.from(f.guard).toString('base64'))} | base64 -d > ${quote(f.base + '.sh')}; /bin/sh ${quote(f.base + '.sh')}`);
  if (result.code !== 0) throw new Error('Cannot establish isolated CF-only origin firewall; website firewall unchanged');
  return `/bin/sh ${f.base}.sh`;
}

export async function verifyOriginFirewall(ssh: NodeSSH, nodeId: string, port: number, ref: string) {
  const f = originFirewall(nodeId, port, ref);
  const result = await remoteExec(ssh, `set -eu; test ! -L ${quote(f.base + '.sha256')}; ` +
    `test "$(sha256sum ${quote(f.base + '.nft')} | cut -d ' ' -f 1)" = ${quote(createHash('sha256').update(f.config).digest('hex'))}; ` +
    `test "$(sha256sum ${quote(f.base + '.sh')} | cut -d ' ' -f 1)" = ${quote(createHash('sha256').update(f.guard).digest('hex'))}; ` +
    `actual="$(nft -s list table inet ${f.table})"; test "$(printf '%s' "$actual" | sha256sum | cut -d ' ' -f 1)" = "$(cat ${quote(f.base + '.sha256')})"`);
  if (result.code !== 0) throw new Error('CF origin firewall missing or changed');
}

export async function removeOriginFirewall(ssh: NodeSSH, nodeId: string, port: number, ref: string) {
  const f = originFirewall(nodeId, port, ref);
  const result = await remoteExec(ssh, `set -eu; nft list tables >/dev/null; ` +
    `if nft list table inet ${f.table} >/dev/null 2>&1; then ` +
    `nft list table inet ${f.table} | grep -Fq ${quote(`comment "${f.marker}"`)}; nft delete table inet ${f.table}; fi; ` +
    `rm -f -- ${quote(f.base + '.nft')} ${quote(f.base + '.sh')} ${quote(f.base + '.sha256')}`);
  if (result.code !== 0) throw new Error('Owned CF origin firewall cleanup failed');
}
