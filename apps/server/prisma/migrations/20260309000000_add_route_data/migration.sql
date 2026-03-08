-- AlterTable: add routeData JSON column to ServerIpCheck (nullable, non-breaking)
ALTER TABLE "ServerIpCheck" ADD COLUMN "routeData" JSONB;
