-- Change Node.exitServerId FK from ON DELETE SET NULL to ON DELETE CASCADE.
-- Previously, deleting a server that served as the *exit* of a chain node left the
-- chain node orphaned (exitServerId set to NULL, record retained as a broken half-chain).
-- A chain node is meaningless once its exit server is gone, so it must be deleted too.

-- DropForeignKey
ALTER TABLE "Node" DROP CONSTRAINT "Node_exitServerId_fkey";

-- AddForeignKey
ALTER TABLE "Node" ADD CONSTRAINT "Node_exitServerId_fkey" FOREIGN KEY ("exitServerId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE;
