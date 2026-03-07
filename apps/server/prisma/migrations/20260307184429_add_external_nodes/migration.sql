-- CreateTable
CREATE TABLE "ExternalNode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "protocol" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "uuid" TEXT,
    "password" TEXT,
    "method" TEXT,
    "transport" TEXT,
    "tls" TEXT NOT NULL DEFAULT 'NONE',
    "sni" TEXT,
    "path" TEXT,
    "rawUri" TEXT,
    "lastTestedAt" TIMESTAMP(3),
    "lastReachable" BOOLEAN,
    "lastLatency" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalSubscriptionNode" (
    "subscriptionId" TEXT NOT NULL,
    "externalNodeId" TEXT NOT NULL,

    CONSTRAINT "ExternalSubscriptionNode_pkey" PRIMARY KEY ("subscriptionId","externalNodeId")
);

-- CreateIndex
CREATE INDEX "ExternalNode_userId_idx" ON "ExternalNode"("userId");

-- AddForeignKey
ALTER TABLE "ExternalNode" ADD CONSTRAINT "ExternalNode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalSubscriptionNode" ADD CONSTRAINT "ExternalSubscriptionNode_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalSubscriptionNode" ADD CONSTRAINT "ExternalSubscriptionNode_externalNodeId_fkey" FOREIGN KEY ("externalNodeId") REFERENCES "ExternalNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

