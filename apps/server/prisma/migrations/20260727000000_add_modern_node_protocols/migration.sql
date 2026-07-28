-- Refuse to mutate the schema while any physical server has an ambiguous port
-- assignment. Historical rows may have statsPort = NULL; in that case mirror
-- NodesService.derivedStatsPort exactly (including treating a NULL
-- implementation as XRAY) so listen, derived/explicit stats, and chain exit
-- ports are checked as one namespace per server.
DO $$
DECLARE
  conflict_server_id TEXT;
  conflict_port INTEGER;
  conflict_occupants TEXT;
BEGIN
  WITH occupied_ports AS (
    SELECT
      "serverId" AS server_id,
      "listenPort" AS port,
      'listen'::TEXT AS kind,
      "id" AS node_id
    FROM "Node"

    UNION ALL

    SELECT
      "serverId" AS server_id,
      COALESCE(
        "statsPort",
        CASE
          WHEN "listenPort" + 20000 <= 65535 THEN "listenPort" + 20000
          WHEN "listenPort" - 20000 >= 1 THEN "listenPort" - 20000
          ELSE 40000 + ("listenPort" % 10000)
        END
      ) AS port,
      'stats'::TEXT AS kind,
      "id" AS node_id
    FROM "Node"
    WHERE
      "statsPort" IS NOT NULL
      OR COALESCE("implementation"::TEXT, 'XRAY') IN ('XRAY', 'V2RAY')

    UNION ALL

    SELECT
      "exitServerId" AS server_id,
      "exitPort" AS port,
      'chain-exit'::TEXT AS kind,
      "id" AS node_id
    FROM "Node"
    WHERE "exitServerId" IS NOT NULL AND "exitPort" IS NOT NULL
  )
  SELECT
    server_id,
    port,
    STRING_AGG(
      FORMAT('%s(node=%s)', kind, node_id),
      ', ' ORDER BY kind, node_id
    )
  INTO conflict_server_id, conflict_port, conflict_occupants
  FROM occupied_ports
  GROUP BY server_id, port
  HAVING COUNT(*) > 1
  ORDER BY server_id, port
  LIMIT 1;

  IF conflict_server_id IS NOT NULL THEN
    RAISE EXCEPTION USING
      MESSAGE = FORMAT(
        'NextPanel upgrade blocked: server %s port %s has conflicting assignments: %s.',
        conflict_server_id,
        conflict_port,
        conflict_occupants
      ),
      HINT = 'Resolve the listen, stats, or chain-exit port conflict on this server, then retry the migration.';
  END IF;
END $$;

-- AlterEnum
ALTER TYPE "Protocol" ADD VALUE 'TUIC';
ALTER TYPE "Protocol" ADD VALUE 'ANYTLS';

-- AlterEnum
ALTER TYPE "Transport" ADD VALUE 'XHTTP';

-- Retain complete REALITY and XHTTP parameters when importing external nodes
-- so connectivity tests and generated subscriptions can reproduce the link.
ALTER TABLE "ExternalNode" ADD COLUMN "shortId" TEXT;
ALTER TABLE "ExternalNode" ADD COLUMN "xhttpMode" TEXT;
ALTER TABLE "ExternalNode" ADD COLUMN "xhttpHost" TEXT;
ALTER TABLE "ExternalNode" ADD COLUMN "xhttpExtra" TEXT;

-- Historical rendered configs contain plaintext protocol credentials even
-- though Node.credentialsEnc is encrypted. No application path reads snapshot
-- content, so remove the legacy secret copies before new snapshots switch to
-- AES-GCM encrypted content.
UPDATE "ConfigSnapshot" SET "content" = '', "checksum" = '';

-- These constraints serialize same-kind allocation races. NodesService uses a
-- per-server advisory lock and the same expanded port namespace for cross-kind
-- conflicts after this migration.
CREATE UNIQUE INDEX "Node_serverId_listenPort_key" ON "Node"("serverId", "listenPort");
CREATE UNIQUE INDEX "Node_exitServerId_exitPort_key" ON "Node"("exitServerId", "exitPort");
