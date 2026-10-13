#!/usr/bin/env python3
"""Record/verify the finite maintenance backup set; never starts a restore."""

import argparse
import hashlib
import json
import os
import shutil
import tarfile
from pathlib import Path

REQUIRED = {
    "application.dump",
    "scheduler-history.tar.gz",
    "scheduler-queue.tar.gz",
    "installation.env",
    "VERSION",
    "compose.yaml",
    "nginx.conf.template",
    "tls/fullchain.pem",
    "tls/privkey.pem",
    "SOURCE.json",
    "BACKUP.json",
}


def file_sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def files(directory):
    result = set()
    for path in directory.rglob("*"):
        if path.is_symlink() or not (path.is_file() or path.is_dir()):
            raise ValueError("Backup must contain only regular files and directories")
        if path.is_file() and path.relative_to(directory).as_posix() not in {
            "SHA256SUMS",
            "SHA256SUMS.tmp",
            "INCOMPLETE",
        }:
            result.add(path.relative_to(directory).as_posix())
    return result


def verify(directory, *, preparing=False):
    directory = Path(directory)
    if (directory / "INCOMPLETE").exists() and not preparing:
        raise ValueError("Incomplete backup")
    entries = {}
    for line in (
        (directory / ("SHA256SUMS.tmp" if preparing else "SHA256SUMS"))
        .read_text()
        .splitlines()
    ):
        digest, name = line.split("  ", 1)
        if len(digest) != 64 or any(c not in "0123456789abcdef" for c in digest):
            raise ValueError("Invalid checksum")
        if name in entries or Path(name).is_absolute() or ".." in Path(name).parts:
            raise ValueError("Invalid checksum path")
        entries[name] = digest
    actual = files(directory)
    if set(entries) != actual or not REQUIRED <= actual:
        raise ValueError("Incomplete checksum coverage or missing backup artifact")
    for name, digest in entries.items():
        path = directory / name
        if (
            not path.stat().st_size
            or file_sha256(path) != digest
        ):
            raise ValueError(f"Backup checksum refused: {name}")
    metadata = json.loads((directory / "BACKUP.json").read_text())
    if (
        metadata["version"] != (directory / "VERSION").read_text().strip()
        or json.loads((directory / "SOURCE.json").read_text())["version"]
        != metadata["version"]
    ):
        raise ValueError("Backup version mismatch")
    for name in metadata["composeFiles"]:
        if "configuration/" + name not in entries:
            raise ValueError("Missing deployment configuration")
    for name in ("scheduler-history.tar.gz", "scheduler-queue.tar.gz"):
        with tarfile.open(directory / name) as archive:
            members = archive.getmembers()
            if not any(m.isfile() and m.size for m in members):
                raise ValueError("Empty scheduler archive")
            for member in members:
                if (
                    member.name.startswith("/")
                    or ".." in Path(member.name).parts
                    or not (member.isfile() or member.isdir())
                ):
                    raise ValueError("Unsafe scheduler archive")
    return entries


def compose_paths(installation):
    installation = installation.resolve()
    selected = os.environ.get("COMPOSE_FILE", "deploy/compose.yaml").split(os.pathsep)
    paths = []
    for name in selected:
        candidate = installation / name
        path = candidate.resolve()
        if (
            candidate.is_symlink()
            or installation not in path.parents
            or not path.is_file()
        ):
            raise ValueError("Compose files must be regular files inside installation")
        paths.append(path)
    return paths


def create(directory, installation):
    installation = installation.resolve()
    names = []
    for path in compose_paths(installation):
        relative = path.relative_to(installation).as_posix()
        target = directory / "configuration" / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(path, target)
        names.append(relative)
    shutil.copyfile(
        installation / "deploy/nginx.conf.template", directory / "nginx.conf.template"
    )
    # The controlled HTTPS fixture has an extra installation CA. It is part of
    # that installation's configuration, not a source-store dependency.
    fixture_ca = installation / "deploy/receiver-tls"
    if fixture_ca.exists():
        shutil.copytree(fixture_ca, directory / "receiver-tls")
    provenance = installation / "SOURCE.json"
    if provenance.exists():
        shutil.copyfile(provenance, directory / "SOURCE.json")
    else:
        # A source checkout is also supported; record exact tracked source hashes.
        import subprocess

        def git(*args):
            return (
                subprocess.check_output(["git", "-C", str(installation), *args])
                .decode()
                .strip()
            )

        tracked = git("ls-files", "-z").split("\0")
        (directory / "SOURCE.json").write_text(
            json.dumps(
                {
                    "version": (directory / "VERSION").read_text().strip(),
                    "commit": git("rev-parse", "HEAD"),
                    "workingTree": git("status", "--porcelain"),
                    "files": {
                        n: file_sha256(installation / n)
                        for n in tracked
                        if n
                    },
                },
                indent=2,
            )
            + "\n"
        )
    import datetime

    (directory / "BACKUP.json").write_text(
        json.dumps(
            {
                "version": (directory / "VERSION").read_text().strip(),
                "boundary": "maintenance: ingress/web/inngest/redis stopped; no other writers",
                # datetime.UTC requires Python 3.11; deployment supports Python 3.9.
                "completedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),  # noqa: UP017
                "composeFiles": names,
            },
            indent=2,
        )
        + "\n"
    )
    actual = files(directory)
    if not REQUIRED <= actual:
        raise ValueError("Missing backup artifact")
    temporary = directory / "SHA256SUMS.tmp"
    temporary.write_text(
        "".join(
            f"{file_sha256(directory / name)}  {name}\n"
            for name in sorted(actual)
        )
    )
    # The incomplete marker remains until every artifact passes verification.
    verify(directory, preparing=True)
    temporary.replace(directory / "SHA256SUMS")
    (directory / "INCOMPLETE").unlink()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["create", "verify"])
    parser.add_argument("directory", type=Path)
    parser.add_argument("--installation", type=Path, default=Path.cwd())
    args = parser.parse_args()
    try:
        if args.action == "create":
            create(args.directory, args.installation)
        else:
            verify(args.directory)
    except (ValueError, OSError, KeyError, tarfile.TarError) as error:
        raise SystemExit(str(error))
