import { buildXrayClientConfig } from './config-builder';

describe('buildXrayClientConfig', () => {
  it('builds VLESS XHTTP REALITY with path and short ID', () => {
    const config = JSON.parse(
      buildXrayClientConfig(
        {
          protocol: 'VLESS',
          transport: 'XHTTP',
          tls: 'REALITY',
          host: '1.2.3.4',
          port: 443,
          domain: 'www.microsoft.com',
          credentials: {
            uuid: 'test-uuid',
            path: '/hidden-path',
            xhttpHost: 'edge.example.com',
            xhttpMode: 'stream-one',
            xhttpExtra: '{"noSSEHeader":true,"xmux":{"maxConcurrency":"8-16"}}',
            shortId: '0123456789abcdef',
            realityPublicKey: 'public-key',
          },
        },
        20100,
      ),
    );

    const outbound = config.outbounds[0];
    expect(outbound.settings.vnext[0].users[0].flow).toBe('');
    expect(outbound.streamSettings).toMatchObject({
      network: 'xhttp',
      security: 'reality',
      xhttpSettings: {
        path: '/hidden-path',
        host: 'edge.example.com',
        mode: 'stream-one',
        extra: { noSSEHeader: true, xmux: { maxConcurrency: '8-16' } },
      },
      realitySettings: {
        serverName: 'www.microsoft.com',
        fingerprint: 'chrome',
        publicKey: 'public-key',
        shortId: '0123456789abcdef',
      },
    });
  });

  it('rejects invalid XHTTP mode and extra before spawning Xray', () => {
    const node = {
      protocol: 'VLESS',
      transport: 'XHTTP',
      tls: 'NONE',
      host: '1.2.3.4',
      port: 443,
      domain: null,
      credentials: { uuid: 'test-uuid', xhttpMode: 'invalid' },
    };

    expect(() => buildXrayClientConfig(node, 20100)).toThrow('Unsupported XHTTP mode');
    expect(() => buildXrayClientConfig({
      ...node,
      credentials: { ...node.credentials, xhttpMode: 'auto', xhttpExtra: '[]' },
    }, 20100)).toThrow('XHTTP extra must be a JSON object');
  });

  it('keeps Vision flow for VLESS TCP REALITY', () => {
    const config = JSON.parse(
      buildXrayClientConfig(
        {
          protocol: 'VLESS',
          transport: 'TCP',
          tls: 'REALITY',
          host: '1.2.3.4',
          port: 443,
          domain: null,
          credentials: { uuid: 'test-uuid' },
        },
        20100,
      ),
    );

    expect(config.outbounds[0].settings.vnext[0].users[0].flow).toBe(
      'xtls-rprx-vision',
    );
  });

  it('builds an authenticated SOCKS5 outbound', () => {
    const config = JSON.parse(
      buildXrayClientConfig(
        {
          protocol: 'SOCKS5',
          transport: null,
          tls: 'NONE',
          host: 'proxy.example.com',
          port: 1080,
          domain: null,
          credentials: { username: 'proxy-user', password: 'proxy-pass' },
        },
        20101,
      ),
    );

    expect(config.outbounds[0]).toMatchObject({
      protocol: 'socks',
      settings: {
        address: 'proxy.example.com',
        port: 1080,
        user: 'proxy-user',
        pass: 'proxy-pass',
      },
    });
  });
});
