CREATE TABLE "ServerSystemInfo" (
    "serverId" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "agentVersion" TEXT NOT NULL,
    "fields" JSONB NOT NULL,
    "missingFields" TEXT[] NOT NULL,
    "collectedAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ServerSystemInfo_pkey" PRIMARY KEY ("serverId"),
    CONSTRAINT "ServerSystemInfo_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
