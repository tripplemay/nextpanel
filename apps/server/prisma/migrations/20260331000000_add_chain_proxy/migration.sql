-- AlterTable: Add chain proxy fields to Node
ALTER TABLE "Node" ADD COLUMN "exitServerId" TEXT;
ALTER TABLE "Node" ADD COLUMN "exitPort" INTEGER;
ALTER TABLE "Node" ADD COLUMN "chainCredEnc" TEXT;

-- AddForeignKey
ALTER TABLE "Node" ADD CONSTRAINT "Node_exitServerId_fkey" FOREIGN KEY ("exitServerId") REFERENCES "Server"("id") ON DELETE SET NULL ON UPDATE CASCADE;
