ALTER TABLE "User" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TYPE "AuditAction" ADD VALUE 'CREDENTIAL_READ';
ALTER TABLE "ExternalNode" ADD COLUMN "credentialsEnc" TEXT;

-- Existing rows are migrated with the application's ENCRYPTION_KEY before restart.
-- NOT VALID still rejects any new plaintext writes, including from old processes.
ALTER TABLE "ExternalNode" ADD CONSTRAINT "ExternalNode_encrypted_credentials"
CHECK ("credentialsEnc" IS NOT NULL AND "uuid" IS NULL AND "username" IS NULL
  AND "password" IS NULL AND "rawUri" IS NULL AND "xhttpExtra" IS NULL AND "shortId" IS NULL) NOT VALID;
