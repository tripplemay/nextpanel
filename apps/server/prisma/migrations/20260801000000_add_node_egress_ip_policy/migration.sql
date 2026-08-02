-- CreateEnum
CREATE TYPE "EgressIpPolicy" AS ENUM ('AUTO', 'IPV4_ONLY');

-- AlterTable
ALTER TABLE "Node"
ADD COLUMN "egressIpPolicy" "EgressIpPolicy" NOT NULL DEFAULT 'AUTO';
