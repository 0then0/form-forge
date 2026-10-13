"""Contract regressions; real store restore is exercised by acceptance/run.py."""

import importlib.util
import hashlib
import io
import json
import os
import shutil
import subprocess
import tarfile
import tempfile
import tracemalloc
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


manifest = load("backup_manifest", "deploy/backup_manifest.py")
cold = load("cold_restore", "deploy/acceptance/cold_restore.py")
cleanup = load("cleanup", "deploy/acceptance/cleanup.py")


def archive(path, name="main.db"):
    with tarfile.open(path, "w:gz") as tar:
        member = tarfile.TarInfo(name)
        member.size = 7
        tar.addfile(member, io.BytesIO(b"fixture"))


class BackupManifestTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        base = Path(self.temporary.name)
        self.installation, self.backup = base / "installation", base / "backup"
        self.backup.mkdir()
        (self.installation / "deploy/tls").mkdir(parents=True)
        for name in ("compose.yaml", "nginx.conf.template"):
            (self.installation / "deploy" / name).write_text("configuration\n")
        (self.installation / "SOURCE.json").write_text(
            '{"version":"fixture","commit":"fixture","files":{}}\n'
        )
        for name in ("application.dump", "installation.env", "VERSION", "compose.yaml"):
            (self.backup / name).write_text("fixture\n")
        (self.backup / "tls").mkdir()
        for name in ("fullchain.pem", "privkey.pem"):
            (self.backup / "tls" / name).write_text("fixture\n")
        for name in ("scheduler-history.tar.gz", "scheduler-queue.tar.gz"):
            archive(self.backup / name)
        (self.backup / "INCOMPLETE").touch()
        self.environment = patch.dict(
            os.environ, {"COMPOSE_FILE": "deploy/compose.yaml"}
        )
        self.environment.start()
        self.addCleanup(self.environment.stop)

    def complete(self):
        manifest.create(self.backup, self.installation)
        return manifest.verify(self.backup)

    def test_external_compose_selection_refused_before_docker_or_destination(self):
        shutil.copyfile(
            ROOT / "deploy/backup.sh", self.installation / "deploy/backup.sh"
        )
        shutil.copyfile(
            ROOT / "deploy/backup_manifest.py",
            self.installation / "deploy/backup_manifest.py",
        )
        destination = self.backup.parent / "never-created"
        environment = {**os.environ, "COMPOSE_FILE": "/outside.yaml"}
        result = subprocess.run(
            ["sh", str(self.installation / "deploy/backup.sh"), str(destination)],
            env=environment,
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("inside installation", result.stderr)
        self.assertFalse(destination.exists())

    def test_complete_set_covers_tls_configuration_and_provenance(self):
        hashes = self.complete()
        self.assertIn("tls/privkey.pem", hashes)
        self.assertIn("configuration/deploy/compose.yaml", hashes)
        self.assertIn("SOURCE.json", hashes)
        self.assertFalse((self.backup / "INCOMPLETE").exists())
        self.assertEqual(set(hashes), manifest.files(self.backup))

    def test_large_dump_checksum_is_complete_with_bounded_memory(self):
        dump = self.backup / "application.dump"
        size = 32 * 1024 * 1024
        with dump.open("wb") as stream:
            stream.truncate(size)
        expected = hashlib.sha256()
        block = bytes(1024 * 1024)
        for _ in range(32):
            expected.update(block)
        tracemalloc.start()
        try:
            hashes = self.complete()
            _, peak = tracemalloc.get_traced_memory()
        finally:
            tracemalloc.stop()
        self.assertEqual(hashes["application.dump"], expected.hexdigest())
        self.assertLess(peak, 8 * 1024 * 1024)
        with dump.open("r+b") as stream:
            stream.seek(-1, os.SEEK_END)
            stream.write(b"x")
        with self.assertRaisesRegex(ValueError, "checksum refused: application.dump"):
            manifest.verify(self.backup)

    def test_corrupt_archive_and_tls_are_refused(self):
        hashes = self.complete()
        for name in ("scheduler-queue.tar.gz", "tls/privkey.pem"):
            original = (self.backup / name).read_bytes()
            (self.backup / name).write_bytes(original + b"corrupted")
            with self.assertRaisesRegex(ValueError, "checksum refused"):
                manifest.verify(self.backup)
            (self.backup / name).write_bytes(original)
        self.assertEqual(manifest.verify(self.backup), hashes)

    def test_missing_file_missing_coverage_extra_file_and_empty_file(self):
        self.complete()
        original = (self.backup / "tls/privkey.pem").read_bytes()
        (self.backup / "tls/privkey.pem").unlink()
        with self.assertRaisesRegex(ValueError, "coverage|missing"):
            manifest.verify(self.backup)
        (self.backup / "tls/privkey.pem").write_bytes(original)
        (self.backup / "unverified").write_text("extra")
        with self.assertRaisesRegex(ValueError, "coverage"):
            manifest.verify(self.backup)
        (self.backup / "unverified").unlink()
        (self.backup / "application.dump").write_bytes(b"")
        with self.assertRaisesRegex(ValueError, "checksum refused"):
            manifest.verify(self.backup)

    def test_failed_backup_has_no_verified_completion(self):
        (self.backup / "application.dump").unlink()
        with self.assertRaisesRegex(ValueError, "Missing backup artifact"):
            manifest.create(self.backup, self.installation)
        self.assertTrue((self.backup / "INCOMPLETE").exists())
        self.assertFalse((self.backup / "SHA256SUMS").exists())
        with self.assertRaisesRegex(ValueError, "Incomplete backup"):
            manifest.verify(self.backup)

    def test_invalid_archive_cannot_complete_backup(self):
        archive(self.backup / "scheduler-history.tar.gz", "../outside")
        with self.assertRaisesRegex(ValueError, "Unsafe"):
            manifest.create(self.backup, self.installation)
        self.assertTrue((self.backup / "INCOMPLETE").exists())
        self.assertFalse((self.backup / "SHA256SUMS").exists())

    def test_checksum_removal_cannot_hide_missing_tls(self):
        self.complete()
        (self.backup / "tls/privkey.pem").unlink()
        checksums = self.backup / "SHA256SUMS"
        checksums.write_text(
            "".join(
                line + "\n"
                for line in checksums.read_text().splitlines()
                if "tls/privkey.pem" not in line
            )
        )
        with self.assertRaisesRegex(ValueError, "missing"):
            manifest.verify(self.backup)

    def test_nested_manifest_named_files_are_also_covered(self):
        (self.backup / "tls/SHA256SUMS").write_text("extra configuration")
        self.assertIn("tls/SHA256SUMS", self.complete())

    def test_checksum_path_traversal_refused(self):
        self.complete()
        with (self.backup / "SHA256SUMS").open("a") as stream:
            stream.write("0" * 64 + "  ../outside\n")
        with self.assertRaisesRegex(ValueError, "path"):
            manifest.verify(self.backup)

    def test_extra_compose_file_is_preserved_and_external_file_refused(self):
        (self.installation / "deploy/overlay.yaml").write_text("fixture overlay\n")
        with patch.dict(
            os.environ,
            {
                "COMPOSE_FILE": os.pathsep.join(
                    ["deploy/compose.yaml", "deploy/overlay.yaml"]
                )
            },
        ):
            self.assertIn("configuration/deploy/overlay.yaml", self.complete())
        (self.backup / "configuration/deploy/overlay.yaml").unlink()
        with self.assertRaises(ValueError):
            manifest.verify(self.backup)
        with patch.dict(os.environ, {"COMPOSE_FILE": "/outside.yaml"}), self.assertRaisesRegex(
            ValueError, "inside installation"
        ):
            manifest.create(self.backup, self.installation)


class IsolationTests(unittest.TestCase):
    def test_refuses_existing_destination_same_project_and_storage_reuse(self):
        self.assertTrue(cold.claim_new_destination(
            "source",
            "dest",
            ["source-pg"],
            ["dest-pg", "dest-sqlite", "dest-redis"],
            ["source-pg"],
        ))
        for project, volumes, existing in (
            ("source", ["a", "b", "c"], []),
            ("dest", ["source-pg", "b", "c"], []),
            ("dest", ["a", "b", "c"], ["b"]),
            ("dest", ["a", "b"], []),
            ("dest", ["a", "a", "b"], []),
        ):
            with self.assertRaises(ValueError):
                cold.claim_new_destination(
                    "source", project, ["source-pg"], volumes, existing
                )

    def containers(self):
        source = [
            {
                "Id": "source",
                "Mounts": [{"Type": "volume", "Name": "source-pg"}],
                "State": {"Running": False},
                "Config": {"Labels": {"com.docker.compose.service": "postgres"}},
            }
        ]
        dest = [
            {
                "Id": "dest",
                "Name": "dest-worker",
                "Mounts": [
                    {
                        "Type": "volume",
                        "Name": name,
                        "Source": "/volumes/" + name,
                        "Destination": "/data/" + name,
                    }
                    for name in ["dest-pg", "dest-sqlite", "dest-redis"]
                ],
                "Config": {
                    "Labels": {"com.docker.compose.project": "dest"},
                    "Env": [
                        "DATABASE_URL=postgresql://fixture@postgres:5432/form_forge"
                    ],
                },
                "NetworkSettings": {
                    "Networks": {"dest_default": {}, "source_receiver-fixture": {}}
                },
            }
        ]
        return source, dest

    def check(self, source, dest):
        return cold.inspect_isolation(
            source,
            dest,
            "source",
            "dest",
            "/source",
            "/dest",
            "source_receiver-fixture",
        )

    def test_actual_mount_network_database_and_running_source_refusal(self):
        source, dest = self.containers()
        self.assertTrue(self.check(source, dest)["sourceStopped"])
        mutations = [
            lambda s, d: d[0]["Mounts"].append({"Type": "volume", "Name": "source-pg"}),
            lambda s, d: d[0]["Mounts"].append(
                {"Type": "bind", "Source": "/source/deploy/tls"}
            ),
            lambda s, d: d[0]["NetworkSettings"]["Networks"].update(
                {"source_default": {}}
            ),
            lambda s, d: d[0]["Config"].update(
                {
                    "Env": [
                        "DATABASE_URL=postgresql://fixture@source-postgres:5432/form_forge"
                    ]
                }
            ),
            lambda s, d: d[0]["Config"].update(
                {"Env": ["INNGEST_REDIS_URI=redis://:fixture@source-redis:6379/0"]}
            ),
            lambda s, d: d[0]["Config"].update(
                {"Env": ["INNGEST_BASE_URL=http://source-inngest:8288"]}
            ),
            lambda s, d: s[0]["State"].update({"Running": True}),
            lambda s, d: d[0].update({"Id": "source"}),
        ]
        for mutate in mutations:
            source, dest = self.containers()
            mutate(source, dest)
            with self.assertRaises(ValueError):
                self.check(source, dest)

    def test_restored_redis_values_required_but_expired_keys_explicit(self):
        before = {
            "run": {"type": "hash", "ttlMs": -1, "valueSha256": "stored"},
            "lease": {"type": "string", "ttlMs": 100, "valueSha256": "lease"},
        }
        after = {"run": {"type": "hash", "ttlMs": -1, "valueSha256": "stored"}}
        self.assertEqual(cold.compare_redis(before, after, 200)["verifiedKeys"], 1)
        with self.assertRaisesRegex(ValueError, "No surviving"):
            cold.compare_redis({}, {}, 0)
        with self.assertRaisesRegex(ValueError, "not restored"):
            cold.compare_redis(before, {}, 200)


class ScopedCleanupTests(unittest.TestCase):
    def test_only_named_compose_project_is_removed_and_remaining_is_failure(self):
        commands = []

        def run(command, **kwargs):
            commands.append(command)
            return (
                "leftover"
                if "label=com.docker.compose.project=owned" in command
                and command[1] == "ps"
                else ""
            )

        dc_calls = []
        result = cleanup.cleanup_resources(
            run, lambda *a, **k: dc_calls.append(a), "owned"
        )
        self.assertEqual(dc_calls, [("down", "--volumes", "--remove-orphans")])
        self.assertFalse(result["passed"])
        self.assertFalse(
            any("prune" in command or "rm" in command for command in commands)
        )

    def test_cleanup_command_failure_cannot_pass_even_if_queries_would_be_empty(self):
        def failed(*args, **kwargs):
            raise RuntimeError("Compose cleanup failed")

        result = cleanup.cleanup_resources(lambda *a, **k: "", failed, "owned")
        self.assertFalse(result["passed"])
        self.assertEqual(result["errors"], ["Compose cleanup failed"])

    def test_cleanup_transport_failures_are_reported_but_programming_errors_propagate(self):
        for error in (OSError("Docker missing"), subprocess.TimeoutExpired("docker", 1)):
            def failed(*args, **kwargs):
                raise error

            result = cleanup.cleanup_resources(lambda *a, **k: "", failed, "owned")
            self.assertFalse(result["passed"])
            self.assertEqual(result["errors"], [str(error)])

        def programming_error(*args, **kwargs):
            raise TypeError("invalid cleanup invocation")

        with self.assertRaisesRegex(TypeError, "invalid cleanup invocation"):
            cleanup.cleanup_resources(lambda *a, **k: "", programming_error, "owned")

    def test_scenario_failure_is_preserved_and_cleanup_failure_exits_nonzero(self):
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "report.json"
            cleanup.save_report(
                {"status": "failed", "error": "checksum refusal"},
                output,
                {"passed": True},
            )
            self.assertEqual(json.loads(output.read_text())["status"], "failed")
            with self.assertRaises(SystemExit):
                cleanup.save_report({"status": "passed"}, output, {"passed": False})
            self.assertEqual(json.loads(output.read_text())["status"], "failed")


class DockerScopedCleanupTests(unittest.TestCase):
    def test_refused_existing_destination_preserves_its_volume_and_contents(self):
        if (
            shutil.which("docker") is None
            or subprocess.run(
                ["docker", "info"], capture_output=True, check=False
            ).returncode
        ):
            self.skipTest("Docker unavailable")
        project = "ff-destination-test-" + os.urandom(6).hex()
        volume = project + "_application-data"
        image = "node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20"

        def run(command, check=True):
            return subprocess.run(
                command, capture_output=True, text=True, check=check, timeout=60
            ).stdout.strip()

        with tempfile.TemporaryDirectory() as temporary:
            compose_file = Path(temporary) / "compose.yaml"
            compose_file.write_text(
                "services:\n  postgres:\n    image: " + image
                + "\n    volumes: [application-data:/data]\nvolumes:\n  application-data: {}\n"
            )
            compose = ["docker", "compose", "-p", project, "-f", str(compose_file)]
            try:
                run([
                    "docker", "volume", "create",
                    "--label", "com.docker.compose.project=" + project,
                    "--label", "com.docker.compose.volume=application-data", volume,
                ])
                run([
                    "docker", "run", "--rm", "--network", "none",
                    "-v", volume + ":/data", image, "sh", "-c",
                    "printf preserved-data > /data/sentinel",
                ])
                destination_owned = False
                try:
                    with self.assertRaisesRegex(ValueError, "Destination stores are not new"):
                        destination_owned = cold.claim_new_destination(
                            "source", project, ["source-pg", "source-sqlite", "source-redis"],
                            [project + "_" + name for name in (
                                "application-data", "scheduler-history", "scheduler-queue"
                            )],
                            run(["docker", "volume", "ls", "-q"]).splitlines(),
                        )
                finally:
                    if destination_owned:
                        cleanup.cleanup_resources(
                            run, lambda *a, **k: run([*compose, *a], **k), project
                        )
                # inspect first: docker run would otherwise silently recreate a deleted volume.
                self.assertEqual(run([
                    "docker", "volume", "inspect", volume, "--format", "{{.Name}}"
                ]), volume)
                self.assertEqual(run([
                    "docker", "run", "--rm", "--network", "none",
                    "-v", volume + ":/data:ro", image, "cat", "/data/sentinel",
                ]), "preserved-data")
            finally:
                run(["docker", "volume", "rm", volume], check=False)

    def test_fixture_profile_cleanup_removes_its_stores_but_preserves_unowned_volume(
        self,
    ):
        if (
            shutil.which("docker") is None
            or subprocess.run(
                ["docker", "info"], capture_output=True, check=False
            ).returncode
        ):
            self.skipTest("Docker unavailable")
        project = "ff-cleanup-test-" + os.urandom(6).hex()
        sentinel = project + "-unowned"
        with tempfile.TemporaryDirectory() as temporary:
            compose_file = Path(temporary) / "compose.yaml"
            compose_file.write_text("""services:
  receiver:
    image: node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20
    profiles: [fixture]
    command: [node, -e, "setInterval(()=>{},1000)"]
    volumes: [profile-data:/evidence]
volumes:
  profile-data:
""")
            compose = [
                "docker",
                "compose",
                "-p",
                project,
                "-f",
                str(compose_file),
                "--profile",
                "fixture",
            ]

            def run(command, check=True):
                result = subprocess.run(
                    command, capture_output=True, text=True, check=False, timeout=60
                )
                if check and result.returncode:
                    raise RuntimeError(result.stderr)
                return result.stdout.strip()

            try:
                run(["docker", "volume", "create", sentinel])
                run([*compose, "create", "--no-build", "receiver"])
                result = cleanup.cleanup_resources(
                    run, lambda *a, **k: run([*compose, *a], **k), project
                )
                self.assertTrue(result["passed"], result)
                self.assertEqual(
                    run(
                        [
                            "docker",
                            "volume",
                            "inspect",
                            sentinel,
                            "--format",
                            "{{.Name}}",
                        ]
                    ),
                    sentinel,
                )
            finally:
                run([*compose, "down", "--volumes", "--remove-orphans"], check=False)
                run(["docker", "volume", "rm", sentinel], check=False)


class EvidenceSerializationTests(unittest.TestCase):
    def test_sqlite_binary_identities_are_safe_serializable_metadata(self):
        import sqlite3

        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            db = directory / "main.db"
            connection = sqlite3.connect(db)
            connection.executescript("""
create table apps(id blob,name text,url text);
create table functions(id blob,app_id blob,name text,slug text);
create table events(internal_id blob,event_id text,event_name text);
create table function_runs(run_id blob,function_id blob,trigger_type text);
create table history(id blob,run_id blob,type text,attempt integer);
create table trace_runs(run_id text,function_id blob,status integer,queued_at integer,started_at integer,ended_at integer);
""")
            identity = bytes(range(16))
            connection.execute(
                "insert into apps values (?,?,?)",
                (identity, "Fixture", "http://web:3000/api/inngest"),
            )
            connection.execute(
                "insert into functions values (?,?,?,?)",
                (identity, identity, "Fixture", "fixture"),
            )
            connection.commit()
            connection.close()
            output = directory / "history.tar.gz"
            with tarfile.open(output, "w:gz") as archive:
                archive.add(db, arcname="./main.db")
            metadata = cold.sqlite_metadata(output.read_bytes())
            self.assertEqual(metadata["apps"][0][0], identity.hex())
            self.assertEqual(metadata["functions"][0][1], identity.hex())
            self.assertEqual(json.loads(json.dumps(metadata)), metadata)

    def test_unserializable_failure_overwrites_old_passed_report_and_preserves_error(
        self,
    ):
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "report.json"
            output.write_text('{"status":"passed"}')
            with self.assertRaises(TypeError):
                cleanup.save_report(
                    {
                        "status": "failed",
                        "error": "original scenario error",
                        "evidence": object(),
                    },
                    output,
                    {"passed": True},
                )
            result = json.loads(output.read_text())
            self.assertEqual(result["status"], "failed")
            self.assertEqual(result["error"], "original scenario error")
            self.assertEqual(result["reportFailure"], "Evidence serialization failed")
