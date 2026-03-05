/*
  Warnings:

  - Made the column `userId` on table `Node` required. This step will fail if there are existing NULL values in that column.
  - Made the column `userId` on table `Server` required. This step will fail if there are existing NULL values in that column.

*/
-- Clear rows with NULL userId before enforcing NOT NULL constraint
DELETE FROM "Node" WHERE "userId" IS NULL;
DELETE FROM "Server" WHERE "userId" IS NULL;

-- DropForeignKey
ALTER TABLE "Node" DROP CONSTRAINT "Node_userId_fkey";

-- DropForeignKey
ALTER TABLE "Server" DROP CONSTRAINT "Server_userId_fkey";

-- AlterTable
ALTER TABLE "Node" ALTER COLUMN "userId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Server" ALTER COLUMN "userId" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "Server" ADD CONSTRAINT "Server_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Node" ADD CONSTRAINT "Node_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
