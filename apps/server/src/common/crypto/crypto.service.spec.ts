import { CryptoService } from './crypto.service';
import { ConfigService } from '@nestjs/config';

// 64-char hex = 32 bytes
const TEST_KEY = 'a'.repeat(64);

function makeService(keyHex = TEST_KEY): CryptoService {
  const config = { getOrThrow: () => keyHex } as unknown as ConfigService;
  return new CryptoService(config);
}

describe('CryptoService', () => {
  describe('constructor', () => {
    it('constructs successfully with a valid 64-hex key', () => {
      expect(() => makeService()).not.toThrow();
    });

    it('throws when key is not 32 bytes (wrong hex length)', () => {
      expect(() => makeService('aabbcc')).toThrow('ENCRYPTION_KEY must be 32 bytes');
    });
  });

  describe('encrypt / decrypt round-trip', () => {
    it('decrypts back to the original plaintext', () => {
      const svc = makeService();
      const plaintext = 'hello world';
      expect(svc.decrypt(svc.encrypt(plaintext))).toBe(plaintext);
    });

    it('handles empty string', () => {
      const svc = makeService();
      expect(svc.decrypt(svc.encrypt(''))).toBe('');
    });

    it('handles unicode characters', () => {
      const svc = makeService();
      const text = '中文 🔑 emoji';
      expect(svc.decrypt(svc.encrypt(text))).toBe(text);
    });

    it('handles JSON strings', () => {
      const svc = makeService();
      const json = JSON.stringify({ uuid: '1234', password: 'secret' });
      expect(svc.decrypt(svc.encrypt(json))).toBe(json);
    });

    it('produces different ciphertext on each call (random IV)', () => {
      const svc = makeService();
      const c1 = svc.encrypt('same-plaintext');
      const c2 = svc.encrypt('same-plaintext');
      expect(c1).not.toBe(c2);
    });

    it('ciphertext is base64 encoded', () => {
      const svc = makeService();
      const c = svc.encrypt('test');
      expect(() => Buffer.from(c, 'base64')).not.toThrow();
    });

    it('throws when decrypting tampered ciphertext (auth tag mismatch)', () => {
      const svc = makeService();
      const cipher = svc.encrypt('sensitive');
      const buf = Buffer.from(cipher, 'base64');
      // Flip a byte in the ciphertext portion (after 28-byte header)
      buf[28] ^= 0xff;
      expect(() => svc.decrypt(buf.toString('base64'))).toThrow();
    });
  });
});
