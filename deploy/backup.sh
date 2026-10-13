#!/bin/sh
# Run only during an explicitly scheduled maintenance window.
set -eu
cd "$(dirname "$0")/.."
destination=${1:?Usage: sh deploy/backup.sh /absolute/new-backup-directory}
case "$destination" in /*) ;; *) echo "Use an absolute destination" >&2; exit 1 ;; esac
# Resolve symlinks before creating anything or stopping services. Backups contain
# secrets and must never be stored in the source/build context.
destination=$(python3 - "$destination" "$PWD" <<'PYTHON'
import sys
from pathlib import Path
backup = Path(sys.argv[1]).resolve()
source = Path(sys.argv[2]).resolve()
if backup == source or source in backup.parents:
    raise SystemExit("Backup destination must be outside the project directory")
print(backup)
PYTHON
)
# Standard Compose selectors let disposable installations use their own project
# and checked-in fixture overlay. Defaults retain the production procedure.
export COMPOSE_FILE=${COMPOSE_FILE:-deploy/compose.yaml}
python3 - <<'PYTHON'
from pathlib import Path
from deploy.backup_manifest import compose_paths
compose_paths(Path.cwd())
PYTHON
# Refuse to overwrite a previous backup.
umask 077
mkdir "$destination"
touch "$destination/INCOMPLETE"
dc() { docker compose --env-file deploy/.env "$@"; }
dc stop ingress inngest web
dc stop redis
if [ -n "$(dc ps --status running -q ingress inngest web redis)" ]; then
    echo "Backup refused: writers are still running" >&2
    exit 1
fi
# SQLite WAL and Redis multipart AOF are copied in full while their writers are stopped.
dc exec -T postgres pg_dump -U form_forge -d form_forge -Fc > "$destination/application.dump"
dc run --rm --no-deps -T --entrypoint tar inngest -C /var/lib/inngest -czf - . > "$destination/scheduler-history.tar.gz"
dc run --rm --no-deps -T --entrypoint tar redis -C /data -czf - . > "$destination/scheduler-queue.tar.gz"
dc exec -T postgres pg_restore --list < "$destination/application.dump" > /dev/null
cp deploy/.env "$destination/installation.env"
cp deploy/VERSION "$destination/VERSION"
cp deploy/compose.yaml "$destination/compose.yaml"
cp -R deploy/tls "$destination/tls"
python3 deploy/backup_manifest.py create "$destination"
echo "Backup complete. Encrypt and move the ENTIRE directory to restricted backup storage."
echo "Services remain stopped for operator inspection; resume with the installation guide."
