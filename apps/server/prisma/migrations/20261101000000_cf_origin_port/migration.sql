ALTER TABLE "Node" ADD COLUMN "publicPort" INTEGER;
ALTER TABLE "Node" ADD COLUMN "cfOriginRoute" JSONB;
ALTER TABLE "Node" ADD CONSTRAINT "Node_publicPort_check"
  CHECK ("publicPort" IS NULL OR ("publicPort" = 443 AND "protocol" = 'VLESS' AND "transport" IS NOT NULL AND "transport" = 'XHTTP' AND "tls" = 'TLS'));
ALTER TABLE "ResourceCleanup" DROP CONSTRAINT "ResourceCleanup_role_check";
ALTER TABLE "ResourceCleanup" ADD CONSTRAINT "ResourceCleanup_role_check"
  CHECK ("role" IN ('ENTRY', 'EXIT', 'DNS', 'CF_ORIGIN'));
