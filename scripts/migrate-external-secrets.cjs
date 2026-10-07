#!/usr/bin/env node
// Run after schema migration, with old backend stopped and the existing encryption key.
const path = require('node:path');
const { createRequire } = require('node:module');
const server = path.resolve(__dirname, '../apps/server');
const requireServer = createRequire(path.join(server, 'package.json'));
const { PrismaClient } = requireServer('@prisma/client');
const { CryptoService } = require(path.join(server, 'dist/common/crypto/crypto.service.js'));
const { migrateExternalSecrets } = require(path.join(server, 'dist/external-nodes/migrate-external-secrets.js'));

async function main() {
  const prisma = new PrismaClient();
  try {
    const cipher = new CryptoService({ getOrThrow: name => {
      if (!process.env[name]) throw new Error('Missing encryption key');
      return process.env[name];
    } });
    const count = await migrateExternalSecrets(prisma, cipher);
    console.log(`External credential migration verified; migrated ${count} rows.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(() => {
  // Prisma errors may contain query arguments. Never print secrets on failure.
  console.error('External credential migration failed; transaction rolled back. Check schema, existing key and encrypted records before restart.');
  process.exitCode = 1;
});
