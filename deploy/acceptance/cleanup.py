"""Cleanup and reporting for one disposable acceptance project."""

import json


def cleanup_resources(run, dc, project, restore_container, restore_volume):
    errors = []
    remaining = {}
    try:
        run(["docker", "rm", "-f", restore_container], check=False)
        run(["docker", "volume", "rm", restore_volume], check=False)
        dc("down", "--volumes", "--remove-orphans", check=False)
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
        if restore_container in containers:
            remaining["containers"].append(restore_container)
        if restore_volume in volumes:
            remaining["volumes"].append(restore_volume)
    except Exception as error:
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
    output.write_text(json.dumps(report, indent=2) + "\n")
    # Preserve an earlier scenario exception; fail a previously successful run.
    if previously_passed and not cleanup["passed"]:
        raise SystemExit(1)
