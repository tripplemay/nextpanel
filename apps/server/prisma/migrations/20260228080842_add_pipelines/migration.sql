-- CreateEnum
CREATE TYPE "PipelineTrigger" AS ENUM ('MANUAL', 'WEBHOOK');

-- CreateEnum
CREATE TYPE "PipelineRunStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCESS', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "Pipeline" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "repoUrl" TEXT NOT NULL,
    "branch" TEXT NOT NULL DEFAULT 'main',
    "githubTokenEnc" TEXT,
    "webhookSecret" TEXT NOT NULL,
    "workDir" TEXT NOT NULL DEFAULT '/opt/apps',
    "buildCommands" TEXT[],
    "deployCommands" TEXT[],
    "serverIds" TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Pipeline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PipelineRun" (
    "id" TEXT NOT NULL,
    "pipelineId" TEXT NOT NULL,
    "trigger" "PipelineTrigger" NOT NULL DEFAULT 'MANUAL',
    "status" "PipelineRunStatus" NOT NULL DEFAULT 'PENDING',
    "commitSha" TEXT,
    "commitMsg" TEXT,
    "branch" TEXT,
    "log" TEXT,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PipelineRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PipelineRun_pipelineId_createdAt_idx" ON "PipelineRun"("pipelineId", "createdAt");

-- AddForeignKey
ALTER TABLE "PipelineRun" ADD CONSTRAINT "PipelineRun_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "Pipeline"("id") ON DELETE CASCADE ON UPDATE CASCADE;
