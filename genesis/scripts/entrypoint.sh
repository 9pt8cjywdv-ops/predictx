#!/bin/sh
set -e
# Apply database migrations before starting (idempotent).
alembic upgrade head
exec "$@"
