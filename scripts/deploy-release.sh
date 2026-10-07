#!/usr/bin/env bash
# Production-only release transaction for the dedicated NextPanel database.
set -Eeuo pipefail
umask 077

APP=/opt/apps/nextpanel
BACKUPS=/opt/backups/nextpanel/releases
DB_CONTAINER=nextpanel-postgres
mkdir -p "$BACKUPS"
exec 9>"$BACKUPS/deploy.lock"
flock -n 9 || { echo 'Another NextPanel deploy/rollback is running' >&2; exit 1; }

wait_health() {
  local legacy=${1:-false}
  for ((i=0; i<60; i++)); do
    if curl -fsS --max-time 3 http://127.0.0.1:3200/login >/dev/null &&
       { if [[ "$legacy" == true ]]; then
           [[ $(curl -sS --max-time 3 -o /dev/null -w '%{http_code}' http://127.0.0.1:3201/api/servers) == 401 ]]
         else
           curl -fsS --max-time 3 http://127.0.0.1:3201/api/health/ready >/dev/null
         fi; }; then return 0; fi
    sleep 2
  done
  return 1
}

stop_panel() {
  pm2 stop nextpanel-server nextpanel-web
}

start_panel() {
  # Names are scoped: never restart other applications on this shared host.
  pm2 delete nextpanel-server nextpanel-web >/dev/null 2>&1 || true
  pm2 start "$APP/ecosystem.config.cjs"
  pm2 save
}

restore_database() {
  docker exec -i "$DB_CONTAINER" sh -ec '
    dropdb -U "$POSTGRES_USER" --force "$POSTGRES_DB"
    createdb -U "$POSTGRES_USER" -O "$POSTGRES_USER" "$POSTGRES_DB"
    pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
      --exit-on-error --single-transaction
  ' < "$BACKUP/database.dump"
}

rollback() {
  [[ -d "$BACKUP/app" && -s "$BACKUP/database.dump" ]] || return 1
  stop_panel || return 1
  restore_database || return 1
  mv "$APP" "$BACKUP/failed-app" || return 1
  mv "$BACKUP/app" "$APP" || return 1
  start_panel || return 1
  wait_health true || return 1
  date -u +%FT%TZ > "$BACKUP/ROLLED_BACK"
  echo "Rollback verified: $BACKUP"
}

MODE=${1:?deploy or rollback}
ID=${2:?release ID required}
[[ "$ID" =~ ^[a-f0-9]{40}$ ]] || { echo 'Expected full commit SHA' >&2; exit 1; }
BACKUP="$BACKUPS/$ID"
if [[ "$MODE" == rollback ]]; then
  rollback
  exit
fi
[[ "$MODE" == deploy ]] || exit 2
CANDIDATE="/opt/apps/nextpanel-candidate-$ID"
[[ -d "$CANDIDATE/apps/server" && -f "$APP/apps/server/.env" && ! -e "$BACKUP" ]] || exit 2
mkdir "$BACKUP"
cp -p "$APP/apps/server/.env" "$CANDIDATE/apps/server/.env"
chmod 600 "$CANDIDATE/apps/server/.env"
if [[ -f "$APP/apps/web/.env.local" ]]; then
  cp -p "$APP/apps/web/.env.local" "$CANDIDATE/apps/web/.env.local"
fi
printf '%s\n' "$ID" > "$CANDIDATE/DEPLOYED_COMMIT"

# Build in isolation while the previous release continues serving requests.
cd "$CANDIDATE"
export NODE_OPTIONS=--max-old-space-size=2048 NEXT_TELEMETRY_DISABLED=1
pnpm install --frozen-lockfile
(cd apps/server && pnpm exec prisma generate)
pnpm -r --workspace-concurrency=1 build
unset NODE_OPTIONS NEXT_TELEMETRY_DISABLED
test -f apps/server/dist/main.js
test -s apps/web/.next/BUILD_ID

PHASE=stopping
failed() {
  local status=$?
  trap - ERR
  echo "Deployment failed in phase $PHASE (exit $status)" >&2
  if [[ "$PHASE" == switched ]]; then
    if ! rollback; then
      echo "ROLLBACK FAILED: keep panel stopped and recover $BACKUP manually" >&2
      pm2 stop nextpanel-server nextpanel-web || true
    fi
  else
    start_panel || true
  fi
  exit "$status"
}
trap failed ERR
stop_panel
PHASE=backup
docker exec "$DB_CONTAINER" sh -ec 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$BACKUP/database.dump"
docker exec -i "$DB_CONTAINER" pg_restore --list < "$BACKUP/database.dump" > "$BACKUP/database.list"
sha256sum "$BACKUP/database.dump" > "$BACKUP/database.sha256"
cp -p "$APP/apps/server/.env" "$BACKUP/server.env"
cp -p "$APP/ecosystem.config.cjs" "$BACKUP/ecosystem.config.cjs"
cd /opt/apps
mv "$APP" "$BACKUP/app"
if ! mv "$CANDIDATE" "$APP"; then
  mv "$BACKUP/app" "$APP"
  false
fi
PHASE=switched
cd "$APP/apps/server"
pnpm exec prisma migrate deploy
node --env-file=.env "$APP/scripts/migrate-external-secrets.cjs"
cd "$APP"
start_panel
wait_health
date -u +%FT%TZ > "$BACKUP/VERIFIED"
trap - ERR
echo "Deployment verified: $ID; rollback: bash $APP/scripts/deploy-release.sh rollback $ID"
