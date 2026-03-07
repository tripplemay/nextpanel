-- CreateEnum
CREATE TYPE "IpCheckStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "ServerIpCheck" (
    "id" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "status" "IpCheckStatus" NOT NULL DEFAULT 'PENDING',
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "error" TEXT,
    "ipType" TEXT,
    "asn" TEXT,
    "org" TEXT,
    "country" TEXT,
    "city" TEXT,
    "netflix" TEXT,
    "netflixRegion" TEXT,
    "disney" TEXT,
    "disneyRegion" TEXT,
    "youtube" TEXT,
    "youtubeRegion" TEXT,
    "hulu" TEXT,
    "bilibili" TEXT,
    "openai" TEXT,
    "claude" TEXT,
    "gemini" TEXT,
    "gfwBlocked" BOOLEAN,
    "gfwCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServerIpCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ServerIpCheck_serverId_key" ON "ServerIpCheck"("serverId");

-- AddForeignKey
ALTER TABLE "ServerIpCheck" ADD CONSTRAINT "ServerIpCheck_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE;
