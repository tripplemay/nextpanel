/*
  Warnings:

  - You are about to drop the `Pipeline` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `PipelineRun` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Release` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ReleaseStep` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Template` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "PipelineRun" DROP CONSTRAINT "PipelineRun_pipelineId_fkey";

-- DropForeignKey
ALTER TABLE "Release" DROP CONSTRAINT "Release_createdById_fkey";

-- DropForeignKey
ALTER TABLE "Release" DROP CONSTRAINT "Release_templateId_fkey";

-- DropForeignKey
ALTER TABLE "ReleaseStep" DROP CONSTRAINT "ReleaseStep_releaseId_fkey";

-- DropForeignKey
ALTER TABLE "ReleaseStep" DROP CONSTRAINT "ReleaseStep_serverId_fkey";

-- DropForeignKey
ALTER TABLE "Template" DROP CONSTRAINT "Template_createdById_fkey";

-- AlterTable
ALTER TABLE "Node" ADD COLUMN     "lastLatency" INTEGER,
ADD COLUMN     "lastReachable" BOOLEAN,
ADD COLUMN     "lastTestedAt" TIMESTAMP(3);

-- DropTable
DROP TABLE "Pipeline";

-- DropTable
DROP TABLE "PipelineRun";

-- DropTable
DROP TABLE "Release";

-- DropTable
DROP TABLE "ReleaseStep";

-- DropTable
DROP TABLE "Template";

-- DropEnum
DROP TYPE "PipelineRunStatus";

-- DropEnum
DROP TYPE "PipelineTrigger";

-- DropEnum
DROP TYPE "ReleaseStatus";

-- DropEnum
DROP TYPE "ReleaseStepStatus";

-- DropEnum
DROP TYPE "ReleaseStrategy";
