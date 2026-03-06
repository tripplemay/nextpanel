-- AlterEnum
ALTER TYPE "ServerStatus" ADD VALUE 'DELETING';

-- AlterTable
ALTER TABLE "Server" ADD COLUMN "deleteError" TEXT;
