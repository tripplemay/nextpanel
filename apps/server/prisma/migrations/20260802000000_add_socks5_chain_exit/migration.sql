-- Add an explicit chain exit discriminator and encrypted external SOCKS5 config.
CREATE TYPE "ChainExitType" AS ENUM ('MANAGED_SERVER', 'SOCKS5');

ALTER TABLE "Node"
  ADD COLUMN "exitType" "ChainExitType",
  ADD COLUMN "socksExitEnc" TEXT,
  ADD COLUMN "socksExitName" TEXT;

-- Existing chain nodes are managed server-to-server chains.
UPDATE "Node"
SET "exitType" = 'MANAGED_SERVER'
WHERE "exitServerId" IS NOT NULL;

-- Keep direct, managed, and SOCKS5 nodes mutually exclusive at the database layer.
ALTER TABLE "Node" ADD CONSTRAINT "Node_chain_exit_shape_check" CHECK (
  (
    "exitType" IS NULL
    AND "exitServerId" IS NULL
    AND "exitPort" IS NULL
    AND "chainCredEnc" IS NULL
    AND "socksExitEnc" IS NULL
    AND "socksExitName" IS NULL
  )
  OR
  (
    "exitType" = 'MANAGED_SERVER'
    AND "exitServerId" IS NOT NULL
    AND "exitPort" IS NOT NULL
    AND "chainCredEnc" IS NOT NULL
    AND "socksExitEnc" IS NULL
    AND "socksExitName" IS NULL
  )
  OR
  (
    "exitType" = 'SOCKS5'
    AND "exitServerId" IS NULL
    AND "exitPort" IS NULL
    AND "chainCredEnc" IS NULL
    AND "socksExitEnc" IS NOT NULL
    AND "socksExitName" IS NOT NULL
  )
);
