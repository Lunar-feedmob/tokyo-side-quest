#!/usr/bin/env bash
# Starts an isolated, clearly labelled TEST deployment for Playwright:
# production build of the web app on :3100 + worker, separate database,
# Redis DB and bucket, and the test-only fake vision provider.
# Usage: scripts/e2e-stack.sh start | stop
set -euo pipefail
cd "$(dirname "$0")/.."

export APP_ENV=test
export AI_PROVIDER=fake
export APP_BASE_URL=http://localhost:3100
export DATABASE_URL=${E2E_DATABASE_URL:-postgres://tsq:tsq-local-password@127.0.0.1:5433/tsq_e2e}
export REDIS_URL=${E2E_REDIS_URL:-redis://127.0.0.1:6380/2}
export STORAGE_BUCKET=tsq-e2e
export PHOTO_ATTEMPTS_PER_HOUR=500
export PHOTO_ATTEMPTS_PER_IP_PER_HOUR=500
RUN_DIR=.e2e
mkdir -p "$RUN_DIR"

case "${1:-start}" in
  start)
    docker compose exec -T postgres psql -U tsq -d tsq -tc "select 1 from pg_database where datname='tsq_e2e'" | grep -q 1 \
      || docker compose exec -T postgres psql -U tsq -d tsq -c "create database tsq_e2e" >/dev/null
    pnpm --silent db:migrate
    pnpm --silent db:seed
    # Test-only reviewer account in the throwaway e2e database.
    (cd packages/core && npx tsx --env-file-if-exists=../../.env -e '(async () => {
      const { createAdmin } = await import("./src/services/admin-auth.ts");
      const { closeDb } = await import("./src/db/client.ts");
      const { closeRedis } = await import("./src/infra/redis.ts");
      await createAdmin({ username: "e2e-reviewer", password: "e2e-reviewer-password", role: "owner" }).catch(() => undefined);
      await closeRedis(); await closeDb();
    })()')
    [ "${SKIP_BUILD:-0}" = "1" ] || pnpm --filter @tsq/web exec next build >"$RUN_DIR/build.log" 2>&1
    ROOT=$(pwd)
    setsid bash -c "cd '$ROOT/apps/web' && exec npx next start -p 3100" </dev/null >"$RUN_DIR/web.log" 2>&1 &
    echo $! >"$RUN_DIR/web.pid"
    setsid bash -c "cd '$ROOT/apps/worker' && exec npx tsx --env-file-if-exists=../../.env src/main.ts" </dev/null >"$RUN_DIR/worker.log" 2>&1 &
    echo $! >"$RUN_DIR/worker.pid"
    for _ in $(seq 1 60); do curl -sf http://localhost:3100/api/v1/health/live >/dev/null && break; sleep 1; done
    echo "e2e stack ready on http://localhost:3100"
    ;;
  stop)
    for f in web worker; do [ -f "$RUN_DIR/$f.pid" ] && kill -- -"$(cat "$RUN_DIR/$f.pid")" 2>/dev/null || true; rm -f "$RUN_DIR/$f.pid"; done
    echo "e2e stack stopped"
    ;;
esac
