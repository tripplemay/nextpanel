CREATE TABLE "RuleCache" (
    "name"      TEXT NOT NULL,
    "content"   TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RuleCache_pkey" PRIMARY KEY ("name")
);
