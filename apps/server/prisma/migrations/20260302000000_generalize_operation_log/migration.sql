-- OperationLog: rename nodeId → resourceId, nodeName → resourceName
ALTER TABLE "OperationLog" RENAME COLUMN "nodeId" TO "resourceId";
ALTER TABLE "OperationLog" RENAME COLUMN "nodeName" TO "resourceName";

-- OperationLog: add resourceType (backfill existing rows as 'node')
ALTER TABLE "OperationLog" ADD COLUMN "resourceType" TEXT NOT NULL DEFAULT 'node';
ALTER TABLE "OperationLog" ALTER COLUMN "resourceType" DROP DEFAULT;

-- OperationLog: convert operation from OpType enum to TEXT
ALTER TABLE "OperationLog" ALTER COLUMN "operation" TYPE TEXT USING "operation"::TEXT;

-- OperationLog: add correlationId
ALTER TABLE "OperationLog" ADD COLUMN "correlationId" TEXT;

-- OperationLog: drop old index on nodeId (renamed), create new indexes
DROP INDEX IF EXISTS "OperationLog_nodeId_idx";
CREATE INDEX "OperationLog_resourceType_resourceId_idx" ON "OperationLog"("resourceType", "resourceId");
CREATE INDEX "OperationLog_correlationId_idx" ON "OperationLog"("correlationId");

-- AuditLog: add correlationId
ALTER TABLE "AuditLog" ADD COLUMN "correlationId" TEXT;
CREATE INDEX "AuditLog_correlationId_idx" ON "AuditLog"("correlationId");

-- Drop OpType enum (no longer used)
DROP TYPE IF EXISTS "OpType";
