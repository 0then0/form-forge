"""Cleanup and reporting for one disposable acceptance project."""

import json
import subprocess


def cleanup_resources(run, dc, project, restore_container=None, restore_volume=None):
    errors = []
    remaining = {}
    try:
        if restore_container:
            run(["docker", "rm", "-f", restore_container], check=False)
        if restore_volume:
            run(["docker", "volume", "rm", restore_volume], check=False)
        dc("down", "--volumes", "--remove-orphans")
        for kind, command in {
            "containers": ["docker", "ps", "-aq"],
            "volumes": ["docker", "volume", "ls", "-q"],
            "networks": ["docker", "network", "ls", "-q"],
        }.items():
            remaining[kind] = run(
                [*command, "--filter", f"label=com.docker.compose.project={project}"]
            ).splitlines()
        # The restore resources were created outside Compose and have no labels.
        containers = run(["docker", "ps", "-a", "--format", "{{.Names}}"]).splitlines()
        volumes = run(["docker", "volume", "ls", "-q"]).splitlines()
        if restore_container and restore_container in containers:
            remaining["containers"].append(restore_container)
        if restore_volume and restore_volume in volumes:
            remaining["volumes"].append(restore_volume)
    except (OSError, RuntimeError, subprocess.SubprocessError) as error:
        errors.append(str(error))
    return {
        "remaining": remaining,
        "errors": errors,
        "passed": not errors and not any(remaining.values()),
    }


def save_report(report, output, cleanup):
    previously_passed = report.get("status") == "passed"
    report["cleanup"] = cleanup
    if not cleanup["passed"]:
        report["status"] = "failed"
        report.setdefault("error", "Disposable environment cleanup failed")
    output.parent.mkdir(parents=True, exist_ok=True)
    try:
        serialized = json.dumps(report, indent=2)
    except (TypeError, ValueError):
        # Preserve an explicit failed report even if diagnostic evidence cannot
        # be serialized. Never leave an older passed report at the same path.
        fallback = {
            "status": "failed",
            "error": report.get("error", "Evidence serialization failed"),
            "reportFailure": "Evidence serialization failed",
            "cleanup": cleanup,
        }
        output.write_text(json.dumps(fallback, indent=2) + "\n")
        raise
    output.write_text(serialized + "\n")
    # Preserve an earlier scenario exception; fail a previously successful run.
    if previously_passed and not cleanup["passed"]:
        raise SystemExit(1)
