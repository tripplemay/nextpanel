import { PrismaClient } from '@prisma/client';
import { CryptoService } from '../common/crypto/crypto.service';
import { openExternalSecrets, sealExternalSecrets, SECRET_FIELDS } from './external-credentials';

export async function migrateExternalSecrets(prisma: PrismaClient, cipher: CryptoService): Promise<number> {
  return prisma.$transaction(async tx => {
    // Stop old writers before invoking this migration. The lock also serializes reruns.
    await tx.$executeRawUnsafe('LOCK TABLE "ExternalNode" IN ACCESS EXCLUSIVE MODE');
    let cursor: string | undefined;
    let migrated = 0;
    while (true) {
      const nodes = await tx.externalNode.findMany({
        orderBy: { id: 'asc' }, take: 200,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (!nodes.length) break;
      for (const node of nodes) {
        const credentialsEnc = node.credentialsEnc ?? sealExternalSecrets(cipher, node.userId, node);
        const verified = openExternalSecrets(cipher, { ...node, credentialsEnc });
        if (SECRET_FIELDS.some(key => node[key] !== null && node[key] !== verified[key])) {
          throw new Error('External credential migration conflict');
        }
        if (!node.credentialsEnc || SECRET_FIELDS.some(key => node[key] !== null)) {
          await tx.externalNode.update({ where: { id: node.id }, data: {
            credentialsEnc, uuid: null, username: null, password: null, rawUri: null, xhttpExtra: null, shortId: null,
          } });
          migrated++;
        }
      }
      cursor = nodes[nodes.length - 1].id;
    }
    await tx.$executeRawUnsafe('ALTER TABLE "ExternalNode" VALIDATE CONSTRAINT "ExternalNode_encrypted_credentials"');
    return migrated;
  }, { timeout: 300_000, maxWait: 10_000 });
}
