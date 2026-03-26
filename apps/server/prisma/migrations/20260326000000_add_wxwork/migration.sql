-- AlterTable: Add WeChat Work fields to User
ALTER TABLE "User" ADD COLUMN "wxWorkUserId" TEXT;
ALTER TABLE "User" ADD COLUMN "wxWorkName" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_wxWorkUserId_key" ON "User"("wxWorkUserId");

-- CreateTable
CREATE TABLE "WxWorkSetting" (
    "id" TEXT NOT NULL,
    "corpId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "secretEnc" TEXT NOT NULL,
    "proxyUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WxWorkSetting_pkey" PRIMARY KEY ("id")
);
