import type { NodeSSH } from 'node-ssh';
import { remoteExec } from './remote-exec';

export class ListenerNotReadyError extends Error {}

export interface SocketOwner {
  protocol: 'tcp' | 'udp';
  port: number;
  address: string;
  pids: number[];
}

export const SOCKET_SCAN = "set -eu; test \"$(id -u)\" = 0; command -v ss >/dev/null; " +
  "printf 'NEXT_PANEL_SOCKETS_V1\\n'; LC_ALL=C ss -H -lntup; printf 'NEXT_PANEL_SOCKETS_END\\n'";

export function quote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export function resourcePaths(nodeId: string, role: 'ENTRY' | 'EXIT') {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(nodeId)) throw new Error('Invalid resource node ID');
  const suffix = `${role === 'EXIT' ? 'chain-' : ''}${nodeId}`;
  const service = `nextpanel-${suffix}`;
  return {
    service,
    unit: `/etc/systemd/system/${service}.service`,
    config: `/etc/nextpanel/nodes/${suffix}.json`,
    manifest: `/etc/nextpanel/ownership/${service}.json`,
  };
}

export function parseSockets(stdout: string): SocketOwner[] {
  const lines = stdout.trim().split('\n');
  if (lines.shift() !== 'NEXT_PANEL_SOCKETS_V1' || lines.pop() !== 'NEXT_PANEL_SOCKETS_END') {
    throw new Error('Incomplete remote socket inventory');
  }
  if (lines.length > 10000) throw new Error('Remote socket inventory exceeds limit');
  return lines.filter(Boolean).map(line => {
    const m = /^(tcp|udp)\s+\S+\s+\d+\s+\d+\s+(\S+)\s+\S+(?:\s+(.*))?$/.exec(line);
    if (!m) throw new Error('Unrecognized remote socket inventory row');
    const portMatch = /:(\d+)$/.exec(m[2]);
    const port = Number(portMatch?.[1]);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid remote socket port');
    return {
      protocol: m[1] as 'tcp' | 'udp', port, address: m[2],
      pids: [...new Set([...String(m[3] ?? '').matchAll(/\bpid=(\d+)/g)].map(p => Number(p[1])))],
    };
  });
}

export async function scanSockets(ssh: NodeSSH): Promise<SocketOwner[]> {
  const result = await remoteExec(ssh, SOCKET_SCAN);
  if (result.code !== 0) throw new Error('Cannot inspect remote ports (root and ss are required); deployment refused');
  return parseSockets(result.stdout);
}

async function belongsTo(ssh: NodeSSH, socket: SocketOwner, service: string): Promise<boolean> {
  if (!socket.pids.length) return false;
  for (const pid of socket.pids) {
    const result = await remoteExec(ssh, `cat /proc/${pid}/cgroup`, 5000);
    if (result.code !== 0 || !result.stdout.split('\n').some(line => line.split('/').includes(`${service}.service`))) return false;
  }
  return true;
}

/** A listener may only be reused by the exact unit being redeployed, never by binary name. */
export async function assertRemotePorts(
  ssh: NodeSSH,
  ports: number[],
  service?: string,
  requireListening = false,
  protocols: Record<number, ('tcp' | 'udp')[]> = {},
): Promise<void> {
  const sockets = await scanSockets(ssh);
  for (const port of ports) {
    const matches = sockets.filter(s => s.port === port);
    if (requireListening && matches.length === 0) throw new ListenerNotReadyError(`Expected listener missing on port ${port}`);
    if (requireListening && protocols[port]?.some(protocol => !matches.some(s => s.protocol === protocol))) {
      throw new ListenerNotReadyError(`Expected transport listener missing on port ${port}`);
    }
    for (const socket of matches) {
      if (!service || !await belongsTo(ssh, socket, service)) {
        throw new Error(`Port ${port}/${socket.protocol} is occupied by another or unidentified service; refusing to terminate it`);
      }
    }
  }
}

export async function unavailablePorts(ssh: NodeSSH, ownService?: string): Promise<Set<number>> {
  const sockets = await scanSockets(ssh);
  const ports = new Set<number>();
  for (const socket of sockets) {
    if (!ownService || !await belongsTo(ssh, socket, ownService)) ports.add(socket.port);
  }
  return ports;
}

export async function listManagedServices(ssh: NodeSSH): Promise<string[]> {
  const result = await remoteExec(ssh,
    "set -eu; systemctl list-unit-files 'nextpanel-*' --type=service --no-legend --no-pager; " +
    "systemctl list-units 'nextpanel-*' --type=service --all --plain --no-legend --no-pager; printf 'NEXT_PANEL_UNITS_END\\n'",
  );
  if (result.code !== 0 || !result.stdout.trim().endsWith('NEXT_PANEL_UNITS_END')) throw new Error('Cannot inventory managed services');
  const services = result.stdout.split('\n').map(line => line.trim().split(/\s+/)[0])
    .filter(name => /^nextpanel-(?:chain-)?[a-zA-Z0-9_-]+\.service$/.test(name) && name !== 'nextpanel-agent.service');
  return [...new Set(services)].map(s => s.slice(0, -8));
}
