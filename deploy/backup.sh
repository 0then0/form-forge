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
# Refuse to overwrite a previous backup.
umask 077
mkdir "$destination"
dc() { docker compose --env-file deploy/.env -f deploy/compose.yaml "$@"; }
dc stop ingress inngest web
dc stop redis
# SQLite WAL and Redis multipart AOF are copied in full while their writers are stopped.
dc exec -T postgres pg_dump -U form_forge -d form_forge -Fc > "$destination/application.dump"
dc run --rm --no-deps -T --entrypoint tar inngest -C /var/lib/inngest -czf - . > "$destination/scheduler-history.tar.gz"
dc run --rm --no-deps -T --entrypoint tar redis -C /data -czf - . > "$destination/scheduler-queue.tar.gz"
cp deploy/.env "$destination/installation.env"
cp deploy/VERSION "$destination/VERSION"
cp deploy/compose.yaml "$destination/compose.yaml"
cp -R deploy/tls "$destination/tls"
(cd "$destination" && shasum -a 256 application.dump scheduler-history.tar.gz scheduler-queue.tar.gz installation.env VERSION compose.yaml > SHA256SUMS)
echo "Backup complete. Encrypt and move the ENTIRE directory to restricted backup storage."
echo "Services remain stopped for operator inspection; resume with the installation guide."
