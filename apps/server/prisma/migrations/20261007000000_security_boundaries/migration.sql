ALTER TABLE "OperationLog" ADD COLUMN "ownerId" TEXT;
UPDATE "OperationLog" AS log SET "ownerId" = node."userId"
FROM "Node" AS node WHERE log."resourceType" = 'node' AND log."resourceId" = node."id";
UPDATE "OperationLog" AS log SET "ownerId" = server."userId"
FROM "Server" AS server WHERE log."resourceType" = 'server' AND log."resourceId" = server."id";
-- Unattributable historical logs remain visible only to administrators.
CREATE INDEX "OperationLog_ownerId_createdAt_idx" ON "OperationLog"("ownerId", "createdAt");

CREATE TABLE "OAuthState" (
    "id" TEXT NOT NULL,
    "browserHash" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "userId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OAuthState_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "OAuthState_expiresAt_idx" ON "OAuthState"("expiresAt");

-- Old shared responses exposed owner tokens, including shares since revoked.
-- Rotate all owner links once; per-recipient share tokens are not changed.
UPDATE "Subscription" SET "token" = gen_random_uuid()::text;
