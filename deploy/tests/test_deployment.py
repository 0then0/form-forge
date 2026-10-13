"""Behavioral regressions for deployment utilities. No installation secrets used."""

import hashlib
import importlib.util
import json
import os
import shutil
import subprocess
import tarfile
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location(
    "cleanup", ROOT / "deploy/acceptance/cleanup.py"
)
cleanup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cleanup)


def command(*args, **kwargs):
    return subprocess.run(args, capture_output=True, text=True, check=False, **kwargs)


class BackupTests(unittest.TestCase):
    def test_rejects_inside_project_and_symlink_before_docker_or_mkdir(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            project = base / "project"
            (project / "deploy").mkdir(parents=True)
            shutil.copy(ROOT / "deploy/backup.sh", project / "deploy/backup.sh")
            (base / "alias").symlink_to(project, target_is_directory=True)
            for destination in [project, project / "new", base / "alias/new"]:
                result = command(
                    "sh", str(project / "deploy/backup.sh"), str(destination)
                )
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("outside the project", result.stderr)
                self.assertFalse((project / "new").exists())


class CleanupTests(unittest.TestCase):
    def test_detects_unlabelled_restore_resources_and_fails_report(self):
        def run(args, **kwargs):
            if args == ["docker", "ps", "-a", "--format", "{{.Names}}"]:
                return "owned-restore"
            if args == ["docker", "volume", "ls", "-q"]:
                return "owned-restore-data"
            return ""

        result = cleanup.cleanup_resources(
            run, lambda *a, **k: "", "owned", "owned-restore", "owned-restore-data"
        )
        self.assertFalse(result["passed"])
        self.assertEqual(result["remaining"]["volumes"], ["owned-restore-data"])
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "report.json"
            with self.assertRaises(SystemExit) as exit:
                cleanup.save_report({"status": "passed"}, path, result)
            self.assertEqual(exit.exception.code, 1)
            self.assertEqual(json.loads(path.read_text())["status"], "failed")
            report = {"status": "failed", "error": "original scenario failure"}
            cleanup.save_report(report, path, result)
            self.assertEqual(report["error"], "original scenario failure")

    def test_query_failure_cannot_pass_cleanup(self):
        def unavailable(*args, **kwargs):
            raise RuntimeError("Docker unavailable")

        result = cleanup.cleanup_resources(
            unavailable, lambda *a, **k: "", "owned", "restore", "volume"
        )
        self.assertFalse(result["passed"])
        self.assertIn("Docker unavailable", result["errors"])

    def test_success_remains_passed(self):
        result = cleanup.cleanup_resources(
            lambda *a, **k: "", lambda *a, **k: "", "owned", "restore", "volume"
        )
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "report.json"
            cleanup.save_report({"status": "passed"}, path, result)
            self.assertEqual(json.loads(path.read_text())["status"], "passed")


class PackageTests(unittest.TestCase):
    def test_clean_source_determinism_modes_and_secret_guard(self):
        with tempfile.TemporaryDirectory() as temporary:
            project = Path(temporary)
            (project / "deploy").mkdir()
            shutil.copy(ROOT / "deploy/package.py", project / "deploy/package.py")
            (project / "deploy/VERSION").write_text("test\n")
            script = project / "deploy/package.py"
            script.chmod(0o755)
            (project / ".gitignore").write_text("release-artifacts/\n")

            def git(*args):
                result = command("git", "-C", str(project), *args)
                self.assertEqual(result.returncode, 0, result.stderr)
                return result.stdout.strip()

            git("init")
            git("config", "user.name", "Test")
            git("config", "user.email", "test@example.invalid")
            git("add", ".")
            git("commit", "-m", "test")

            def package():
                return command("python3", "-B", str(script))

            self.assertEqual(package().returncode, 0)
            archive = project / "release-artifacts/form-forge-test.tar.gz"
            first = archive.read_bytes()
            self.assertEqual(package().returncode, 0)
            self.assertEqual(first, archive.read_bytes())
            with tarfile.open(archive) as tar:
                self.assertEqual(
                    tar.getmember("form-forge-test/deploy/package.py").mode, 0o755
                )
                manifest = json.load(tar.extractfile("form-forge-test/SOURCE.json"))
                self.assertEqual(manifest["commit"], git("rev-parse", "HEAD"))
                self.assertEqual(
                    manifest["files"]["deploy/package.py"],
                    hashlib.sha256(script.read_bytes()).hexdigest(),
                )
            (project / "note.txt").write_text("unreviewed")
            self.assertIn("Commit reviewed", package().stderr)
            (project / "note.txt").unlink()
            (project / "installation.env").write_text("fake-test-marker")
            git("add", ".")
            git("commit", "-m", "secret fixture")
            self.assertIn("potential secret", package().stderr)


class DockerContextTests(unittest.TestCase):
    def test_backup_credentials_never_enter_build_context(self):
        if shutil.which("docker") is None or command("docker", "info").returncode:
            self.skipTest("Docker is unavailable")
        with tempfile.TemporaryDirectory() as temporary:
            project = Path(temporary)
            shutil.copy(ROOT / ".dockerignore", project / ".dockerignore")
            (project / "Dockerfile").write_text("FROM scratch\nCOPY . /context/\n")
            (project / ".env").write_text("fake-test-marker")
            (project / "installation.env").write_text("fake-test-marker")
            (project / "backups").mkdir()
            (project / "backups/installation.env").write_text("fake-test-marker")
            (project / "public.txt").write_text("public")
            image = "ff-context-test:" + os.urandom(6).hex()
            environment = {**os.environ, "BUILDX_CONFIG": str(project / "buildx")}
            container = None
            try:
                result = command(
                    "docker",
                    "build",
                    "--network",
                    "none",
                    "-t",
                    image,
                    str(project),
                    env=environment,
                    timeout=120,
                )
                self.assertEqual(result.returncode, 0, result.stderr)
                result = command(
                    "docker", "create", "--network", "none", image, "/unused"
                )
                self.assertEqual(result.returncode, 0, result.stderr)
                container = result.stdout.strip()
                result = command(
                    "docker", "export", "-o", str(project / "filesystem.tar"), container
                )
                self.assertEqual(result.returncode, 0, result.stderr)
                with tarfile.open(project / "filesystem.tar") as tar:
                    names = tar.getnames()
                    self.assertIn("context/public.txt", names)
                    self.assertFalse(
                        any(
                            name.endswith(("installation.env", "/.env"))
                            for name in names
                        )
                    )
            finally:
                if container:
                    command("docker", "rm", "-f", container)
                command("docker", "image", "rm", image)
