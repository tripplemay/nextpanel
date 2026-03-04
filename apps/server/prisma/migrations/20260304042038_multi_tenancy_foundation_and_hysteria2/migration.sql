-- AlterEnum
ALTER TYPE "Protocol" ADD VALUE 'HYSTERIA2';

-- AlterTable
ALTER TABLE "Node" ADD COLUMN     "cfDnsRecordId" TEXT,
ADD COLUMN     "userId" TEXT;

-- AlterTable
ALTER TABLE "Server" ADD COLUMN     "userId" TEXT;

-- CreateTable
CREATE TABLE "CloudflareSetting" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "apiTokenEnc" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CloudflareSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CloudflareSetting_userId_key" ON "CloudflareSetting"("userId");

-- CreateIndex
CREATE INDEX "Node_userId_idx" ON "Node"("userId");

-- CreateIndex
CREATE INDEX "Server_userId_idx" ON "Server"("userId");

-- AddForeignKey
ALTER TABLE "Server" ADD CONSTRAINT "Server_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Node" ADD CONSTRAINT "Node_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CloudflareSetting" ADD CONSTRAINT "CloudflareSetting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
