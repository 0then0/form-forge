#!/usr/bin/env python3
"""Package a clean committed source revision without secrets, Git history or binaries."""

import gzip
import hashlib
import io
import json
import subprocess
import tarfile
from pathlib import Path

root = Path(__file__).resolve().parents[1]
version = (root / "deploy/VERSION").read_text().strip()
output = root / "release-artifacts"
output.mkdir(exist_ok=True)


def git(*args):
    return subprocess.check_output(["git", "-C", str(root), *args])


if git("status", "--porcelain").strip():
    raise SystemExit("Commit reviewed changes before packaging a release")

files = sorted(set(git("ls-files", "--cached", "-z").decode().split("\0")) - {""})
for name in files:
    path = Path(name)
    if any(
        part
        in {
            "node_modules",
            ".git",
            "__pycache__",
            "tls",
            "evidence",
            "release-artifacts",
            "backups",
        }
        for part in path.parts
    ):
        raise SystemExit(f"Refusing unexpected release path: {name}")
    if (
        (path.name.startswith(".env") and not path.name.endswith(".example"))
        or path.suffix in {".pem", ".dump"}
        or path.name == "installation.env"
    ):
        raise SystemExit(f"Refusing potential secret: {name}")
    if not (root / name).is_file() or (root / name).is_symlink():
        raise SystemExit(f"Release source must be a regular file: {name}")

manifest = {
    "version": version,
    "commit": git("rev-parse", "HEAD").decode().strip(),
    "contract": "source build per public hostname; no prebuilt or published image",
    "files": {
        name: hashlib.sha256((root / name).read_bytes()).hexdigest() for name in files
    },
}
epoch = int(git("show", "-s", "--format=%ct", "HEAD").decode().strip())
archive = output / f"form-forge-{version}.tar.gz"
with (
    archive.open("wb") as raw,
    gzip.GzipFile(filename="", fileobj=raw, mode="wb", mtime=epoch) as compressed,
    tarfile.open(fileobj=compressed, mode="w") as tar,
):
    for name in [*files, "SOURCE.json"]:
        content = (
            json.dumps(manifest, sort_keys=True, indent=2).encode() + b"\n"
            if name == "SOURCE.json"
            else (root / name).read_bytes()
        )
        info = tarfile.TarInfo(f"form-forge-{version}/{name}")
        info.size = len(content)
        executable = name != "SOURCE.json" and (root / name).stat().st_mode & 0o111
        info.mode = 0o755 if executable else 0o644
        info.mtime = epoch
        tar.addfile(info, io.BytesIO(content))
(output / "SOURCE.json").write_text(
    json.dumps(manifest, sort_keys=True, indent=2) + "\n"
)
(output / "SHA256SUMS").write_text(
    "".join(
        f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.name}\n"
        for path in [archive, output / "SOURCE.json"]
    )
)
print(archive)
print(output / "SHA256SUMS")
