import { ServiceUnavailableException } from '@nestjs/common';
import { CryptoService } from '../common/crypto/crypto.service';

export const SECRET_FIELDS = ['uuid', 'username', 'password', 'rawUri', 'xhttpExtra', 'shortId'] as const;
export type ExternalSecrets = Record<typeof SECRET_FIELDS[number], string | null>;

export const externalNodePublicSelect = {
  id: true, userId: true, name: true, protocol: true, address: true, port: true,
  transport: true, tls: true, lastReachable: true, lastLatency: true,
  lastTestedAt: true, createdAt: true, updatedAt: true,
} as const;

export function sealExternalSecrets(cipher: CryptoService, userId: string, source: Partial<ExternalSecrets>): string {
  const secrets = Object.fromEntries(SECRET_FIELDS.map(key => [key, source[key] ?? null]));
  return cipher.encrypt(JSON.stringify({ version: 1, userId, secrets }));
}

export function openExternalSecrets(cipher: CryptoService, node: { userId: string; credentialsEnc: string | null }): ExternalSecrets {
  try {
    if (!node.credentialsEnc) throw new Error('Not migrated');
    const data = JSON.parse(cipher.decrypt(node.credentialsEnc));
    if (data.version !== 1 || data.userId !== node.userId || !data.secrets) throw new Error('Invalid envelope');
    for (const key of SECRET_FIELDS) {
      if (data.secrets[key] !== null && typeof data.secrets[key] !== 'string') throw new Error('Invalid credential');
    }
    return Object.fromEntries(SECRET_FIELDS.map(key => [key, data.secrets[key]])) as ExternalSecrets;
  } catch {
    // No plaintext fallback or cryptographic error/secret details in HTTP responses.
    throw new ServiceUnavailableException('外部节点凭据不可用，请检查加密密钥与数据迁移');
  }
}
