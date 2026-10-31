ALTER TABLE "Subscription" ADD COLUMN "cfProtectedNodeIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
