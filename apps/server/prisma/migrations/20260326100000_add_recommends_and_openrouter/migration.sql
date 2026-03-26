-- CreateTable OpenRouterSetting
CREATE TABLE "OpenRouterSetting" (
    "id" TEXT NOT NULL,
    "apiKeyEnc" TEXT NOT NULL,
    "model" TEXT NOT NULL DEFAULT 'anthropic/claude-sonnet-4',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OpenRouterSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable ServerRecommendCategory
CREATE TABLE "ServerRecommendCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ServerRecommendCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable ServerRecommend
CREATE TABLE "ServerRecommend" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price" TEXT NOT NULL,
    "regions" TEXT[],
    "link" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ServerRecommend_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ServerRecommend_categoryId_idx" ON "ServerRecommend"("categoryId");

-- AddForeignKey
ALTER TABLE "ServerRecommend" ADD CONSTRAINT "ServerRecommend_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ServerRecommendCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
