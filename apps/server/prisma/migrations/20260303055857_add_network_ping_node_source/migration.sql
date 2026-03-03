-- CreateEnum
CREATE TYPE "NodeSource" AS ENUM ('MANUAL', 'AUTO');

-- AlterTable
ALTER TABLE "Node" ADD COLUMN     "source" "NodeSource" NOT NULL DEFAULT 'MANUAL';

-- AlterTable
ALTER TABLE "Server" ADD COLUMN     "networkIn" BIGINT,
ADD COLUMN     "networkOut" BIGINT,
ADD COLUMN     "pingMs" INTEGER;
