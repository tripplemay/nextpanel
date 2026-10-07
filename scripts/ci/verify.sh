#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$ROOT"
: "${PG_BIN:?Set PG_BIN to a PostgreSQL 16+ toolchain; tests create an isolated cluster}"
export NEXT_TELEMETRY_DISABLED=1
# No test stage requires project credentials or a live backend.
export DATABASE_URL='postgresql://fixture:fixture@127.0.0.1:1/fixture'
export API_URL='http://127.0.0.1:1'
export REQUIRE_SING_BOX=1
run_in() ( cd "$ROOT/$1"; shift; "$@"; )

./node_modules/.bin/eslint apps/server/src apps/web/src packages/shared/src --max-warnings 0
sing-box version
run_in apps/server ./node_modules/.bin/prisma generate
run_in apps/server ./node_modules/.bin/prisma validate
run_in apps/server ./node_modules/.bin/tsc --noEmit --incremental false
run_in apps/server ./node_modules/.bin/jest --runInBand --no-cache --coverage=false
node --test scripts/tests/*.test.mjs
for script in scripts/nextpanel scripts/install.sh scripts/deploy-release.sh apps/agent/install.sh scripts/ci/verify.sh; do
  bash -n "$script"
done
run_in packages/shared ./node_modules/.bin/tsc -p tsconfig.json
run_in apps/server ./node_modules/.bin/nest build
SERVER_BUILD_DIR="$ROOT/apps/server/dist" node --test scripts/tests/database-integration.mjs
run_in apps/web ./node_modules/.bin/tsc --noEmit --incremental false
run_in apps/web ./node_modules/.bin/next build
node scripts/tests/browser-smoke.mjs
