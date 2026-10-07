import { ServiceUnavailableException } from '@nestjs/common';
import { CryptoService } from '../common/crypto/crypto.service';
import { openExternalSecrets, sealExternalSecrets } from './external-credentials';

describe('external credential envelope', () => {
  const cipher = new CryptoService({ getOrThrow: () => 'ab'.repeat(32) } as any);
  const secrets = { uuid: 'secret-id', username: 'user', password: 'secret-pass', rawUri: 'https://user:secret-pass@example.test', xhttpExtra: '{"Authorization":"secret"}', shortId: '0123456789abcdef' };
  const credentialsEnc = sealExternalSecrets(cipher, 'owner', secrets);

  it('round-trips every secret with random nonces and no plaintext in ciphertext', () => {
    expect(openExternalSecrets(cipher, { userId: 'owner', credentialsEnc })).toEqual(secrets);
    expect(credentialsEnc).not.toContain('secret');
    expect(sealExternalSecrets(cipher, 'owner', secrets)).not.toBe(credentialsEnc);
  });

  it('encrypts nullable credentials for unauthenticated proxies', () => {
    expect(openExternalSecrets(cipher, { userId: 'owner', credentialsEnc: sealExternalSecrets(cipher, 'owner', {}) }))
      .toEqual({ uuid: null, username: null, password: null, rawUri: null, xhttpExtra: null, shortId: null });
  });

  it.each([null, '', 'invalid', Buffer.from('tampered').toString('base64')])('fails closed on absent or corrupt encryption: %s', value => {
    expect(() => openExternalSecrets(cipher, { userId: 'owner', credentialsEnc: value })).toThrow(ServiceUnavailableException);
  });

  it('rejects cross-owner ciphertext and a different key', () => {
    expect(() => openExternalSecrets(cipher, { userId: 'foreign', credentialsEnc })).toThrow(ServiceUnavailableException);
    const wrongKey = new CryptoService({ getOrThrow: () => 'cd'.repeat(32) } as any);
    expect(() => openExternalSecrets(wrongKey, { userId: 'owner', credentialsEnc })).toThrow(ServiceUnavailableException);
  });

  it.each([
    { version: 2, userId: 'owner', secrets },
    { version: 1, userId: 'owner', secrets: {} },
    { version: 1, userId: 'owner', secrets: { ...secrets, password: 123 } },
  ])('rejects invalid decrypted envelopes without leaking their contents', data => {
    expect(() => openExternalSecrets(cipher, { userId: 'owner', credentialsEnc: cipher.encrypt(JSON.stringify(data)) }))
      .toThrow('外部节点凭据不可用，请检查加密密钥与数据迁移');
  });
});
