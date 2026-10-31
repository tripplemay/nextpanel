ALTER TABLE "Subscription" ADD COLUMN "cfAuto" BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE "CfOptimization" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "nodeId" TEXT NOT NULL REFERENCES "Node"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "probeId" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "carrier" TEXT NOT NULL,
  "region" TEXT NOT NULL,
  "observations" JSONB NOT NULL,
  "published" JSONB NOT NULL,
  "previous" JSONB NOT NULL,
  "checkedAt" TIMESTAMP(3) NOT NULL,
  "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "discoveredAt" TIMESTAMP(3) NOT NULL,
  "error" TEXT,
  "revision" INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX "CfOptimization_nodeId_probeId_key" ON "CfOptimization"("nodeId", "probeId");
CREATE INDEX "CfOptimization_checkedAt_idx" ON "CfOptimization"("checkedAt");
CREATE TABLE "CfOptimizationState" (
  "key" TEXT NOT NULL PRIMARY KEY,
  "value" JSONB NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
