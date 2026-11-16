#!/usr/bin/env bash
# Dung PostgreSQL trong docker de test driver pg.
#   bash test/pg-test.sh up    /  down
set -euo pipefail
TEN=tableu-pg-test
case "${1:-up}" in
  up)
    docker rm -f "$TEN" >/dev/null 2>&1 || true
    docker run -d --name "$TEN" -e POSTGRES_PASSWORD=pgtest123 \
      -e POSTGRES_USER=postgres -e POSTGRES_DB=tableu_pg \
      -p 127.0.0.1:55432:5432 postgres:16-alpine >/dev/null
    for _ in $(seq 1 40); do
      docker exec "$TEN" pg_isready -U postgres >/dev/null 2>&1 && break
      sleep 1
    done
    echo "PostgreSQL test dang chay o 127.0.0.1:55432 (postgres/pgtest123, db tableu_pg)"
    echo "Chay test:  npm test 13"
    ;;
  down) docker rm -f "$TEN" >/dev/null 2>&1 || true; echo "da don" ;;
  *) echo "Dùng: bash test/pg-test.sh [up|down]"; exit 2 ;;
esac
