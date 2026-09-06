import { parseSubscriptionText, parseUri } from './uri-parser';

describe('external node URI parser', () => {
  it('parses MiyaIP host:port:username:password entries as HTTP by default', () => {
    expect(parseUri('202.58.222.43:8022:xseswzdrqe:ipimtwmiiimyu')).toMatchObject({
      name: 'MiyaIP',
      protocol: 'HTTP',
      address: '202.58.222.43',
      port: 8022,
      username: 'xseswzdrqe',
      password: 'ipimtwmiiimyu',
      tls: 'NONE',
    });
  });

  it('supports selecting SOCKS5 for MiyaIP entries without a scheme', () => {
    expect(parseSubscriptionText('202.58.222.43:8022:xseswzdrqe:ipimtwmiiimyu', 'SOCKS5')).toMatchObject({
      failed: 0,
      nodes: [expect.objectContaining({ protocol: 'SOCKS5', username: 'xseswzdrqe' })],
    });
  });

  it('parses authenticated HTTP proxy URIs', () => {
    expect(parseUri('http://proxy-user:proxy-pass@proxy.example.com:8080#HTTP')).toMatchObject({
      name: 'HTTP', protocol: 'HTTP', address: 'proxy.example.com', port: 8080,
      username: 'proxy-user', password: 'proxy-pass', tls: 'NONE',
    });
  });

  it('parses Base64-authenticated socks URI', () => {
    const credentials = Buffer.from('proxy-user:proxy-pass').toString('base64url');
    const node = parseUri(
      `socks://${credentials}@proxy.example.com:8001#%E7%BE%8E%E5%9B%BD%E5%87%BA%E5%8F%A3`,
    );

    expect(node).toEqual({
      name: '美国出口',
      protocol: 'SOCKS5',
      address: 'proxy.example.com',
      port: 8001,
      username: 'proxy-user',
      password: 'proxy-pass',
      tls: 'NONE',
      rawUri: `socks://${credentials}@proxy.example.com:8001#%E7%BE%8E%E5%9B%BD%E5%87%BA%E5%8F%A3`,
    });
  });

  it('parses URL-encoded SOCKS5 credentials and IPv6 without authentication', () => {
    expect(parseUri('socks5://demo%20user:p%40ss%3Aword@proxy.example.com:1080#Node')).toMatchObject({
      protocol: 'SOCKS5',
      username: 'demo user',
      password: 'p@ss:word',
      address: 'proxy.example.com',
      port: 1080,
    });
    expect(parseUri('socks://[2001:db8::5]:1080#IPv6')).toMatchObject({
      protocol: 'SOCKS5',
      address: '2001:db8::5',
      port: 1080,
    });
  });

  it('imports SOCKS nodes from Base64 subscription content and rejects malformed credentials', () => {
    const uri = 'socks5://user:pass@proxy.example.com:1080#SOCKS';
    expect(parseSubscriptionText(Buffer.from(uri).toString('base64'))).toMatchObject({
      nodes: [expect.objectContaining({ protocol: 'SOCKS5', username: 'user', password: 'pass' })],
      failed: 0,
    });
    expect(parseUri('socks://not-base64@proxy.example.com:1080')).toBeNull();
  });

  it('parses complete VLESS XHTTP REALITY parameters', () => {
    const extra = JSON.stringify({ xPaddingBytes: '100-1000', noSSEHeader: true });
    const query = new URLSearchParams({
      type: 'xhttp',
      security: 'reality',
      path: '/api/v1',
      host: 'edge.example.com',
      mode: 'stream-up',
      extra,
      pbk: 'public-key',
      sid: '0123456789abcdef',
      sni: 'www.google.com',
    });
    const node = parseUri(`vless://test-uuid@203.0.113.10:443?${query}#XHTTP`);

    expect(node).toMatchObject({
      name: 'XHTTP',
      protocol: 'VLESS',
      address: '203.0.113.10',
      port: 443,
      uuid: 'test-uuid',
      transport: 'XHTTP',
      tls: 'REALITY',
      path: '/api/v1',
      xhttpHost: 'edge.example.com',
      xhttpMode: 'stream-up',
      xhttpExtra: extra,
      realityPublicKey: 'public-key',
      shortId: '0123456789abcdef',
      sni: 'www.google.com',
    });
  });

  it('normalizes an uppercase XHTTP transport value', () => {
    expect(parseUri('vless://id@example.com:443?type=XHTTP#Node')).toMatchObject({
      transport: 'XHTTP',
      xhttpMode: 'auto',
    });
  });

  it('does not treat the XHTTP host as TLS SNI', () => {
    const node = parseUri('vless://id@example.com:443?type=xhttp&host=edge.example.com#Node');
    expect(node).toMatchObject({ xhttpHost: 'edge.example.com' });
    expect(node?.sni).toBeUndefined();
  });

  it('keeps VMess XHTTP host, mode, and extra separate from SNI', () => {
    const payload = Buffer.from(JSON.stringify({
      v: '2',
      ps: 'VMess XHTTP',
      add: '203.0.113.10',
      port: '443',
      id: 'test-uuid',
      net: 'xhttp',
      host: 'edge.example.com',
      path: '/api',
      mode: 'packet-up',
      extra: { noSSEHeader: true },
      tls: 'tls',
    })).toString('base64');

    const node = parseUri(`vmess://${payload}`);
    expect(node).toMatchObject({
      transport: 'XHTTP',
      xhttpHost: 'edge.example.com',
      xhttpMode: 'packet-up',
      xhttpExtra: '{"noSSEHeader":true}',
    });
    expect(node?.sni).toBeUndefined();
  });

  it.each(['invalid', 'packet', 'stream', ' auto '])('rejects unsupported XHTTP mode %s', (mode) => {
    const query = new URLSearchParams({ type: 'xhttp', mode });
    expect(parseUri(`vless://id@example.com:443?${query}#Node`)).toBeNull();
  });

  it.each([
    ['invalid JSON', '{'],
    ['JSON array', '[]'],
    ['JSON primitive', 'true'],
    ['oversized JSON object', JSON.stringify({ value: 'x'.repeat(16 * 1024) })],
  ])('rejects %s in XHTTP extra', (_name, extra) => {
    const query = new URLSearchParams({ type: 'xhttp', extra });
    expect(parseUri(`vless://id@example.com:443?${query}#Node`)).toBeNull();
  });

  it('rejects control characters in XHTTP host', () => {
    const query = new URLSearchParams({ type: 'xhttp', host: 'edge.example.com\r\nX-Test: yes' });
    expect(parseUri(`vless://id@example.com:443?${query}#Node`)).toBeNull();
  });

  it.each([
    ['vless://id@[2001:db8::1]:443?type=xhttp#IPv6', 'VLESS'],
    ['trojan://password@[2001:db8::2]:443?type=ws#IPv6', 'TROJAN'],
    ['hy2://password@[2001:db8::3]:8443?sni=example.com#IPv6', 'HYSTERIA2'],
  ])('parses bracketed IPv6 addresses from %s', (uri, protocol) => {
    const node = parseUri(uri);

    expect(node).toMatchObject({ protocol, port: expect.any(Number) });
    expect(node?.address).toMatch(/^2001:db8::/);
    expect(node?.address).not.toContain('[');
  });

  it('parses a bracketed IPv6 address in a SIP002 Shadowsocks URI', () => {
    const credentials = Buffer.from('aes-256-gcm:password').toString('base64url');
    const node = parseUri(`ss://${credentials}@[2001:db8::4]:8388#IPv6`);

    expect(node).toMatchObject({
      protocol: 'SHADOWSOCKS',
      address: '2001:db8::4',
      port: 8388,
    });
  });

  it('counts malformed bracketed host/port input as failed', () => {
    expect(parseSubscriptionText('vless://id@[2001:db8::1?type=xhttp')).toEqual({
      nodes: [],
      failed: 1,
    });
  });
});
