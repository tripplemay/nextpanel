import { PROTOCOL_PRESETS, SUPPORTED_PROTOCOLS, SupportedProtocol } from './presets';

describe('Protocol preset ingress descriptions', () => {
  it.each<[SupportedProtocol, 'DIRECT' | 'CDN']>([
    ['VLESS_REALITY', 'DIRECT'],
    ['VLESS_XHTTP_REALITY', 'DIRECT'],
    ['VLESS_WS_TLS', 'CDN'],
    ['VLESS_XHTTP_TLS', 'CDN'],
    ['VLESS_TCP_TLS', 'DIRECT'],
    ['HYSTERIA2', 'DIRECT'],
    ['TUIC_V5', 'DIRECT'],
    ['ANYTLS', 'DIRECT'],
    ['VMESS_TCP', 'DIRECT'],
  ])('labels %s as %s without inferring CDN from TLS or XHTTP alone', (key, mode) => {
    expect(PROTOCOL_PRESETS[key].accessMode).toBe(mode);
  });

  it('only labels the managed HTTP transport and TLS combinations as CDN', () => {
    for (const key of SUPPORTED_PROTOCOLS) {
      const preset = PROTOCOL_PRESETS[key];
      const cdn = preset.protocol === 'VLESS'
        && ['WS', 'XHTTP'].includes(preset.transport ?? '') && preset.tls === 'TLS';
      expect(preset.accessMode).toBe(cdn ? 'CDN' : 'DIRECT');
    }
  });

  it.each(['ANYTLS', 'TUIC_V5'] as const)('%s explicitly distinguishes DNS/certificates from CDN', (key) => {
    const preset = PROTOCOL_PRESETS[key];
    expect(preset.description).toContain('仅用于 DNS 解析和证书验证，不经过 CDN');
    expect(preset.tags).toContainEqual({ text: 'CF DNS / 证书', color: 'gold' });
    expect(preset.tags.some((tag) => tag.text === '需要 CF + 域名')).toBe(false);
  });
});
