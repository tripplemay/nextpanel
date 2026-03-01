-- CreateEnum
CREATE TYPE "OpType" AS ENUM ('DEPLOY', 'UNDEPLOY');

-- CreateTable
CREATE TABLE "OperationLog" (
    "id" TEXT NOT NULL,
    "nodeId" TEXT,
    "nodeName" TEXT NOT NULL,
    "actorId" TEXT,
    "operation" "OpType" NOT NULL,
    "success" BOOLEAN NOT NULL,
    "log" TEXT,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperationLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OperationLog_nodeId_idx" ON "OperationLog"("nodeId");

-- CreateIndex
CREATE INDEX "OperationLog_createdAt_idx" ON "OperationLog"("createdAt");
