import type { NodeSSH } from 'node-ssh';
import { assertRemotePorts, listManagedServices, parseSockets, resourcePaths, scanSockets, unavailablePorts } from './remote-inventory';
import { boundConnection, remoteExec } from './remote-exec';

const frame = (...rows: string[]) => ['NEXT_PANEL_SOCKETS_V1', ...rows, 'NEXT_PANEL_SOCKETS_END'].join('\n');
const row = (protocol: string, port: number, pid?: number, ip = '0.0.0.0') =>
  `${protocol} ${protocol === 'tcp' ? 'LISTEN' : 'UNCONN'} 0 4096 ${ip}:${port} *:* ${pid ? `users:(("xray",pid=${pid},fd=4))` : ''}`;

describe('remote resource inventory', () => {
  const execCommand = jest.fn();
  const dispose = jest.fn();
  const ssh = { execCommand, dispose } as unknown as NodeSSH;
  beforeEach(() => { execCommand.mockReset(); dispose.mockReset(); });

  it('parses TCP, UDP, IPv4, IPv6 and repeated owners without collapsing reuseport listeners', () => {
    const sockets = parseSockets(frame(row('tcp', 15000, 617), row('tcp', 15000, 618, '[::]'), row('udp', 15000, 619)));
    expect(sockets).toHaveLength(3);
    expect(sockets.map(s => s.pids[0])).toEqual([617, 618, 619]);
    expect(sockets.map(s => s.protocol)).toEqual(['tcp', 'tcp', 'udp']);
  });

  it.each(['', 'NEXT_PANEL_SOCKETS_V1', 'NEXT_PANEL_SOCKETS_END', frame('unexpected'), frame(row('tcp', 65536, 2))])('fails closed on incomplete/malformed output: %s', output => {
    expect(() => parseSockets(output)).toThrow();
  });

  it.each([127, 1, null, undefined])('does not treat exit %s as a free host', async code => {
    execCommand.mockResolvedValue({ code, stdout: frame() });
    await expect(scanSockets(ssh)).rejects.toThrow('Cannot inspect');
  });

  it('rejects a foreign Xray sharing the exact managed port even if one listener is ours', async () => {
    execCommand.mockImplementation(async command => command.includes('ss -H')
      ? { code: 0, stdout: frame(row('tcp', 15000, 617), row('tcp', 15000, 618)) }
      : { code: 0, stdout: `0::/system.slice/${command.includes('617') ? 'nextpanel-chain-current' : 'nextpanel-chain-old'}.service\n` });
    await expect(assertRemotePorts(ssh, [15000], 'nextpanel-chain-current', true)).rejects.toThrow('refusing to terminate');
    expect(execCommand.mock.calls.every(([c]) => !/kill|stop|rm /.test(c))).toBe(true);
  });

  it('allows only exact cgroup ownership and requires every requested transport', async () => {
    execCommand.mockImplementation(async command => command.includes('ss -H')
      ? { code: 0, stdout: frame(row('tcp', 1080, 5)) }
      : { code: 0, stdout: '0::/system.slice/nextpanel-current.service\n' });
    await expect(assertRemotePorts(ssh, [1080], 'nextpanel-current', true, { 1080: ['tcp'] })).resolves.toBeUndefined();
    await expect(assertRemotePorts(ssh, [1080], 'nextpanel-current', true, { 1080: ['tcp', 'udp'] })).rejects.toThrow('transport');
    await expect(assertRemotePorts(ssh, [1080], 'nextpanel-cur')).rejects.toThrow('occupied');
    await expect(assertRemotePorts(ssh, [443], 'nextpanel-current', true)).rejects.toThrow('missing');
    expect(await unavailablePorts(ssh, 'nextpanel-current')).toEqual(new Set());
    expect(await unavailablePorts(ssh)).toEqual(new Set([1080]));
  });

  it('reserves ports with invisible owners and rejects their reuse', async () => {
    execCommand.mockResolvedValue({ code: 0, stdout: frame(row('udp', 443)) });
    expect(await unavailablePorts(ssh, 'nextpanel-current')).toEqual(new Set([443]));
    await expect(assertRemotePorts(ssh, [443], 'nextpanel-current')).rejects.toThrow('unidentified');
  });

  it('inventories disabled and loaded units but excludes the agent', async () => {
    execCommand.mockResolvedValue({ code: 0, stdout: 'nextpanel-old.service disabled\nnextpanel-chain-current.service loaded active running\nnextpanel-agent.service enabled\nNEXT_PANEL_UNITS_END\n' });
    expect(await listManagedServices(ssh)).toEqual(['nextpanel-old', 'nextpanel-chain-current']);
    execCommand.mockResolvedValue({ code: 0, stdout: 'nextpanel-old.service disabled\n' });
    await expect(listManagedServices(ssh)).rejects.toThrow('Cannot inventory');
    expect(() => resourcePaths('../../other', 'ENTRY')).toThrow();
  });

  it('terminates a stalled command instead of occupying the cleanup worker indefinitely', async () => {
    jest.useFakeTimers();
    try {
      execCommand.mockImplementation(() => new Promise(() => {}));
      const failure = expect(remoteExec(ssh, 'test', 100)).rejects.toThrow('timed out');
      await jest.advanceTimersByTimeAsync(101);
      await failure;
      expect(dispose).toHaveBeenCalledTimes(1);
    } finally { jest.useRealTimers(); }
  });

  it('bounds existing helpers through a dedicated connection without recursion', async () => {
    const connection = { execCommand: jest.fn().mockResolvedValue({ code: 0, stdout: 'ok' }), dispose: jest.fn() };
    const original = connection.execCommand;
    expect(await boundConnection(connection as unknown as NodeSSH).execCommand('unit stop')).toEqual({ code: 0, stdout: 'ok' });
    expect(original).toHaveBeenCalledWith('unit stop');
  });
});
