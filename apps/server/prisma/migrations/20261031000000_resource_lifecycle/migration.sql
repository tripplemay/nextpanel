ALTER TABLE "Server" ADD COLUMN "remoteHostId" TEXT, ADD COLUMN "retiredAt" TIMESTAMP(3), ADD COLUMN "cleanupQueuedAt" TIMESTAMP(3);

CREATE TABLE "PanelIdentity" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "instanceId" TEXT NOT NULL UNIQUE
);

CREATE TABLE "ResourceCleanup" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "ownerId" TEXT NOT NULL,
  "deletionServerId" TEXT NOT NULL,
  "serverId" TEXT NOT NULL,
  "serverName" TEXT NOT NULL,
  "nodeId" TEXT NOT NULL,
  "nodeName" TEXT NOT NULL,
  "role" TEXT NOT NULL CHECK ("role" IN ('ENTRY', 'EXIT', 'DNS')),
  "panelInstanceId" TEXT NOT NULL,
  "remoteHostId" TEXT,
  "expectedConfigHashEnc" TEXT,
  "payload" JSONB NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'PENDING' CHECK ("state" IN ('PENDING', 'RUNNING', 'BLOCKED', 'DONE')),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastError" TEXT,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "ResourceCleanup_serverId_nodeId_role_key" ON "ResourceCleanup"("serverId", "nodeId", "role");
CREATE INDEX "ResourceCleanup_state_nextAttemptAt_idx" ON "ResourceCleanup"("state", "nextAttemptAt");
CREATE INDEX "ResourceCleanup_ownerId_createdAt_idx" ON "ResourceCleanup"("ownerId", "createdAt");
CREATE INDEX "ResourceCleanup_deletionServerId_state_idx" ON "ResourceCleanup"("deletionServerId", "state");
CREATE INDEX "ResourceCleanup_remoteHostId_state_idx" ON "ResourceCleanup"("remoteHostId", "state");

CREATE TABLE "ResourceFinding" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "ownerId" TEXT NOT NULL,
  "serverId" TEXT NOT NULL,
  "serviceName" TEXT NOT NULL,
  "nodeId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "detail" TEXT NOT NULL,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3)
);
CREATE UNIQUE INDEX "ResourceFinding_serverId_serviceName_kind_key" ON "ResourceFinding"("serverId", "serviceName", "kind");
CREATE INDEX "ResourceFinding_ownerId_resolvedAt_idx" ON "ResourceFinding"("ownerId", "resolvedAt");
