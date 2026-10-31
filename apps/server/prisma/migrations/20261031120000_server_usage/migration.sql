ALTER TABLE "Subscription" ADD COLUMN "usageEnabled" BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE "UsageNode" (
  "nodeId" TEXT PRIMARY KEY REFERENCES "Node"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "preparedAt" TIMESTAMP(3), "syncedAt" TIMESTAMP(3), "error" TEXT,
  "sampledAt" TIMESTAMP(3), "sampleId" TEXT, "coreUptime" BIGINT,
  "legacyUp" BIGINT NOT NULL DEFAULT 0, "legacyDown" BIGINT NOT NULL DEFAULT 0,
  "legacyActiveAt" TIMESTAMP(3), "legacyUpRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "legacyDownRate" DOUBLE PRECISION NOT NULL DEFAULT 0, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "UsageCredential" (
  "id" TEXT PRIMARY KEY, "nodeId" TEXT NOT NULL REFERENCES "Node"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "ownerId" TEXT NOT NULL, "subscriptionId" TEXT NOT NULL, "subjectUserId" TEXT NOT NULL,
  "grantId" TEXT NOT NULL, "grantVersion" TEXT NOT NULL, "candidateKey" TEXT NOT NULL,
  "candidateIp" TEXT NOT NULL, "carrier" TEXT NOT NULL, "label" TEXT NOT NULL, "uuidEnc" TEXT NOT NULL,
  "installedAt" TIMESTAMP(3), "revokedAt" TIMESTAMP(3), "removedAt" TIMESTAMP(3),
  "lastExportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sampledAt" TIMESTAMP(3), "lastActiveAt" TIMESTAMP(3),
  "upBytes" BIGINT NOT NULL DEFAULT 0, "downBytes" BIGINT NOT NULL DEFAULT 0,
  "upRate" DOUBLE PRECISION, "downRate" DOUBLE PRECISION
);
CREATE UNIQUE INDEX "UsageCredential_nodeId_grantVersion_candidateKey_key" ON "UsageCredential"("nodeId", "grantVersion", "candidateKey");
CREATE INDEX "UsageCredential_ownerId_subscriptionId_idx" ON "UsageCredential"("ownerId", "subscriptionId");
CREATE INDEX "UsageCredential_nodeId_removedAt_idx" ON "UsageCredential"("nodeId", "removedAt");
CREATE TABLE "UsageBucket" (
  "credentialId" TEXT NOT NULL REFERENCES "UsageCredential"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "timestamp" TIMESTAMP(3) NOT NULL, "upBytes" BIGINT NOT NULL DEFAULT 0, "downBytes" BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY ("credentialId", "timestamp")
);
CREATE INDEX "UsageBucket_timestamp_idx" ON "UsageBucket"("timestamp");
