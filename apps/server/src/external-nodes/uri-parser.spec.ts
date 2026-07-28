import { parseSubscriptionText, parseUri } from './uri-parser';

describe('external node URI parser', () => {
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
