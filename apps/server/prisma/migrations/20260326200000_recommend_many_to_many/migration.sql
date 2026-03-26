-- Drop old foreign key and index
ALTER TABLE "ServerRecommend" DROP CONSTRAINT IF EXISTS "ServerRecommend_categoryId_fkey";
DROP INDEX IF EXISTS "ServerRecommend_categoryId_idx";

-- Create junction table
CREATE TABLE "ServerRecommendOnCategory" (
    "categoryId" TEXT NOT NULL,
    "recommendId" TEXT NOT NULL,
    CONSTRAINT "ServerRecommendOnCategory_pkey" PRIMARY KEY ("categoryId","recommendId")
);

-- Migrate existing data: copy categoryId relationships to junction table
INSERT INTO "ServerRecommendOnCategory" ("categoryId", "recommendId")
SELECT "categoryId", "id" FROM "ServerRecommend" WHERE "categoryId" IS NOT NULL;

-- Drop old column
ALTER TABLE "ServerRecommend" DROP COLUMN "categoryId";

-- Add foreign keys
ALTER TABLE "ServerRecommendOnCategory" ADD CONSTRAINT "ServerRecommendOnCategory_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ServerRecommendCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ServerRecommendOnCategory" ADD CONSTRAINT "ServerRecommendOnCategory_recommendId_fkey" FOREIGN KEY ("recommendId") REFERENCES "ServerRecommend"("id") ON DELETE CASCADE ON UPDATE CASCADE;
