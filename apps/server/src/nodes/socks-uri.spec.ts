import { parseSocksUri, parseStoredSocksExit, SocksUriParseError } from './socks-uri';

describe('SOCKS5 URI parser', () => {
  it('parses Base64 username/password credentials and a URL-encoded label', () => {
    const credentials = Buffer.from('demo-user:demo-password').toString('base64url');

    expect(parseSocksUri(
      `socks://${credentials}@proxy.example.com:8001#%E7%BE%8E%E5%9B%BD%E5%87%BA%E5%8F%A3`,
    )).toEqual({
      config: {
        version: 5,
        host: 'proxy.example.com',
        port: 8001,
        username: 'demo-user',
        password: 'demo-password',
      },
      name: '美国出口',
    });
  });

  it('parses standard URL-encoded credentials and preserves colons in the password', () => {
    expect(parseSocksUri('socks5://demo%20user:p%40ss%3Aword@proxy.example.com:1080')).toEqual({
      config: {
        version: 5,
        host: 'proxy.example.com',
        port: 1080,
        username: 'demo user',
        password: 'p@ss:word',
      },
      name: 'SOCKS5 proxy.example.com:1080',
    });
  });

  it('supports unauthenticated bracketed IPv6 addresses', () => {
    expect(parseSocksUri('socks://[2001:db8::10]:1080#IPv6')).toEqual({
      config: { version: 5, host: '2001:db8::10', port: 1080 },
      name: 'IPv6',
    });
  });

  it.each([
    'http://proxy.example.com:1080',
    'socks://proxy.example.com:0',
    'socks://proxy.example.com:65536',
    'socks://not-base64@proxy.example.com:1080',
    'socks://proxy.example.com:1080/path',
    'socks://proxy.example.com:1080#bad%ZZ',
  ])('rejects malformed input: %s', (uri) => {
    expect(() => parseSocksUri(uri)).toThrow(SocksUriParseError);
  });

  it('validates the encrypted database envelope before config generation', () => {
    expect(parseStoredSocksExit(JSON.stringify({
      version: 5,
      host: 'proxy.example.com',
      port: 1080,
      username: 'user',
      password: 'pass',
    }))).toEqual({
      version: 5,
      host: 'proxy.example.com',
      port: 1080,
      username: 'user',
      password: 'pass',
    });
    expect(() => parseStoredSocksExit('{')).toThrow('Stored SOCKS5 exit configuration is invalid');
  });
});
