import { generateConfig, getBinaryCommand } from './config-generator';
import type { NodeInfo, NodeCredentials } from './config-generator';

const baseNode: NodeInfo = {
  id: 'node-1',
  protocol: 'VMESS',
  implementation: 'XRAY',
  transport: 'TCP',
  tls: 'NONE',
  listenPort: 10086,
  domain: null,
};

const baseCreds: NodeCredentials = {
  uuid: 'test-uuid-1234',
  password: 'test-pass',
  method: 'aes-256-gcm',
};

// ── generateConfig routing ────────────────────────────────────────────────────

describe('generateConfig', () => {
  it('routes XRAY implementation to Xray format', () => {
    const json = JSON.parse(generateConfig(baseNode, baseCreds));
    expect(json.log.loglevel).toBe('warning');
    expect(json.inbounds[0].protocol).toBe('vmess');
  });

  it('routes V2RAY implementation to Xray format', () => {
    const node = { ...baseNode, implementation: 'V2RAY' };
    const json = JSON.parse(generateConfig(node, baseCreds));
    expect(json.log.loglevel).toBe('warning');
  });

  it('routes SING_BOX implementation to sing-box format', () => {
    const node = { ...baseNode, implementation: 'SING_BOX' };
    const json = JSON.parse(generateConfig(node, baseCreds));
    expect(json.log.level).toBe('warn');
    expect(json.inbounds[0].type).toBe('vmess');
  });

  it('routes SS_LIBEV implementation to ss-libev format', () => {
    const node = { ...baseNode, implementation: 'SS_LIBEV', protocol: 'SHADOWSOCKS' };
    const json = JSON.parse(generateConfig(node, baseCreds));
    expect(json.server).toBe('0.0.0.0');
    expect(json.server_port).toBe(10086);
  });

  it('defaults to Xray format for unknown implementation', () => {
    const node = { ...baseNode, implementation: 'UNKNOWN_IMPL' };
    const json = JSON.parse(generateConfig(node, baseCreds));
    expect(json.log.loglevel).toBe('warning');
  });

  it('defaults to Xray format when implementation is null', () => {
    const node = { ...baseNode, implementation: null };
    const json = JSON.parse(generateConfig(node, baseCreds));
    expect(json.log.loglevel).toBe('warning');
  });
});

// ── getBinaryCommand ──────────────────────────────────────────────────────────

describe('getBinaryCommand', () => {
  it.each([
    ['XRAY', '/usr/local/bin/xray', 'run -config /etc/nextpanel/nodes/node-1.json'],
    ['V2RAY', '/usr/local/bin/v2ray', 'run -config /etc/nextpanel/nodes/node-1.json'],
    ['SING_BOX', '/usr/local/bin/sing-box', 'run -c /etc/nextpanel/nodes/node-1.json'],
    ['SS_LIBEV', '/usr/bin/ss-server', '-c /etc/nextpanel/nodes/node-1.json'],
  ])('returns correct binary for %s', (impl, expectedBin, expectedArgs) => {
    const node = { ...baseNode, implementation: impl };
    const { bin, args } = getBinaryCommand(node);
    expect(bin).toBe(expectedBin);
    expect(args).toBe(expectedArgs);
  });

  it('defaults to xray binary for unknown implementation', () => {
    const node = { ...baseNode, implementation: 'CUSTOM' };
    const { bin } = getBinaryCommand(node);
    expect(bin).toBe('/usr/local/bin/xray');
  });

  it('defaults to xray when implementation is null', () => {
    const node = { ...baseNode, implementation: null };
    const { bin } = getBinaryCommand(node);
    expect(bin).toBe('/usr/local/bin/xray');
  });
});
