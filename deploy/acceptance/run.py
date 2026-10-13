#!/usr/bin/env python3
"""Disposable real-scheduler/HTTPS-transport drills. Python standard library only.

No production env, sessions, endpoints, database or volumes are reused.
"""

import argparse
import base64
import hashlib
import json
import os
import secrets
import shutil
import subprocess
import sys
import tempfile
import time
import uuid
from pathlib import Path

from cleanup import cleanup_resources, save_report
from cold_restore import (
    DECRYPT,
    INVARIANTS,
    REDIS_CONTENT,
    archive_files,
    claim_new_destination,
    compare_redis,
    inspect_isolation,
    redis_metadata,
    sqlite_metadata,
)

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backup_manifest import verify as verify_backup

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--output", type=Path, default=ROOT / "evidence/local.json")
parser.add_argument(
    "--cold-restore-only",
    action="store_true",
    help="Run the full three-store cold restore; skip extra retained-store/lost-ACK drills",
)
args = parser.parse_args()
project = "ff-acceptance-" + uuid.uuid4().hex[:10]
host = "forms.acceptance.invalid"
port = 18443
report = {
    "project": project,
    "release": (ROOT / "VERSION").read_text().strip(),
    "startedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    "scenarios": {},
    "coldRestoreOnly": args.cold_restore_only,
    "status": "failed",  # Only all scenarios plus cleanup can produce passed.
}


# Setup failures precede Docker creation; replace any older report immediately.
save_report(report, args.output, {"passed": True, "phase": "before Docker creation"})

sensitive_values = set()


def redact(message):
    for value in sensitive_values:
        message = message.replace(value, "[redacted]")
    return message


def run(command, *, input=None, env=None, check=True, timeout=180):
    result = subprocess.run(
        command,
        input=input,
        text=True,
        capture_output=True,
        env=env,
        check=False,
        timeout=timeout,
    )
    if check and result.returncode:
        # Commands never include owner secrets; do not echo runtime environment.
        raise RuntimeError(
            redact(f"Command failed: {' '.join(command)}\n{result.stderr[-4000:]}")
        )
    return result.stdout.strip()


def quote(value):
    return "'" + str(value).replace("'", "''") + "'"


def wait(label, probe, timeout=360):
    print(f"Waiting: {label}", flush=True)
    deadline = time.monotonic() + timeout
    last_error = None
    while time.monotonic() < deadline:
        try:
            result = probe()
            if result:
                return result
        except (RuntimeError, ValueError, KeyError) as error:
            last_error = str(error)
        time.sleep(
            2
        )  # Only polling observed state; never advances a persisted schedule.
    raise RuntimeError(f"Timed out: {label}; {last_error or 'condition not met'}")


with tempfile.TemporaryDirectory(prefix=project + "-") as temporary:
    directory = Path(temporary)
    # Freeze one source revision; both installations get independent files.
    release = directory / "release"
    release.mkdir()
    provenance = ROOT.parent / "SOURCE.json"
    if provenance.exists():
        source_record = json.loads(provenance.read_text())
        names = list(source_record["files"])
    else:
        names = run(["git", "-C", str(ROOT.parent), "ls-files"]).splitlines()
        # New acceptance utilities are intentionally uncommitted during review.
        names = sorted(
            set(names)
            | {
                "deploy/backup_manifest.py",
                "deploy/acceptance/cold_restore.py",
                "deploy/tests/test_cold_restore.py",
            }
        )
        source_record = {
            "commit": run(["git", "-C", str(ROOT.parent), "rev-parse", "HEAD"]),
            "workingTree": run(
                ["git", "-C", str(ROOT.parent), "status", "--porcelain"]
            ),
        }
    for name in names:
        target = release / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT.parent / name, target)
    if provenance.exists():
        for name in names:
            if (
                hashlib.sha256((release / name).read_bytes()).hexdigest()
                != source_record["files"][name]
            ):
                raise RuntimeError("Source release checksum mismatch: " + name)
    source_record["version"] = (ROOT / "VERSION").read_text().strip()
    source_record["files"] = {
        n: hashlib.sha256((release / n).read_bytes()).hexdigest() for n in names
    }
    (release / "SOURCE.json").write_text(json.dumps(source_record, indent=2) + "\n")
    installation = directory / "source"
    destination_installation = directory / "destination"
    shutil.copytree(release, installation)
    shutil.copytree(release, destination_installation)
    (installation / "deploy/evidence").mkdir()
    directory.chmod(0o700)
    keys = {
        "PUBLIC_HOST": host,
        "ACCEPTANCE_PROJECT": project,
        "POSTGRES_PASSWORD": secrets.token_hex(32),
        "REDIS_PASSWORD": secrets.token_hex(32),
        "AUTH_SECRET": secrets.token_hex(32),
        "FINGERPRINT_SECRET": secrets.token_hex(32),
        "WEBHOOK_ENCRYPTION_KEY": base64.b64encode(secrets.token_bytes(32)).decode(),
        "AUTH_GITHUB_ID": str(uuid.uuid4()),
        "AUTH_GITHUB_SECRET": str(uuid.uuid4()),
        "INNGEST_EVENT_KEY": secrets.token_hex(32),
        "INNGEST_SIGNING_KEY": secrets.token_hex(32),
        "RECEIVER_SECRET": secrets.token_urlsafe(32),
        "ACCEPTANCE_DIR": str(installation / "deploy"),
        "HTTPS_BIND": "127.0.0.1",
        "HTTPS_PORT": str(port),
    }
    sensitive_values.update(
        value
        for key, value in keys.items()
        if any(token in key for token in ("SECRET", "PASSWORD", "KEY"))
    )
    env_file = installation / "deploy/.env"
    env_file.write_text(
        "\n".join(f"{key}={value}" for key, value in keys.items()) + "\n"
    )
    env_file.chmod(0o600)
    for folder, name in [
        ("app-tls", host),
        ("receiver-tls", "receiver.form-forge.invalid"),
    ]:
        tls = installation / "deploy" / folder
        tls.mkdir()
        run(
            [
                "openssl",
                "req",
                "-x509",
                "-newkey",
                "rsa:2048",
                "-nodes",
                "-days",
                "2",
                "-keyout",
                str(tls / "privkey.pem"),
                "-out",
                str(tls / "fullchain.pem"),
                "-subj",
                f"/CN={name}",
                "-addext",
                f"subjectAltName=DNS:{name}",
                "-addext",
                "basicConstraints=critical,CA:TRUE",
            ]
        )
    # backup.sh uses the published deploy/tls layout as well as the fixture CA.
    shutil.copytree(installation / "deploy/app-tls", installation / "deploy/tls")
    environment = {
        key: value
        for key, value in os.environ.items()
        if not key.startswith("COMPOSE_") and key not in keys
    }
    environment["BUILDX_CONFIG"] = str(directory / "buildx")
    compose = [
        "docker",
        "compose",
        "--env-file",
        str(env_file),
        "-p",
        project,
        "-f",
        str(installation / "deploy/compose.yaml"),
        "-f",
        str(installation / "deploy/acceptance/compose.yaml"),
    ]

    def dc(*command, input=None, check=True):
        return run(
            [*compose, *command],
            input=input,
            env=environment,
            check=check,
            timeout=1800 if command[0] == "build" else 180,
        )

    def sql(query):
        return json.loads(
            dc(
                "exec",
                "-T",
                "postgres",
                "psql",
                "-U",
                "form_forge",
                "-d",
                "form_forge",
                "-At",
                "-v",
                "ON_ERROR_STOP=1",
                "-c",
                f"select coalesce(json_agg(t),'[]') from ({query}) as t",
            )
        )

    def execute(query):
        return dc(
            "exec",
            "-T",
            "postgres",
            "psql",
            "-U",
            "form_forge",
            "-d",
            "form_forge",
            "-v",
            "ON_ERROR_STOP=1",
            input=query,
        )

    def internal(url, method="GET", data=None):
        script = "const x=JSON.parse(await new Promise(r=>{let s='';process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>r(s))}));const r=await fetch(x.url,{method:x.method,headers:{'content-type':'application/json'},...(x.data===null?{}:{body:JSON.stringify(x.data)}),signal:AbortSignal.timeout(10000)});console.log(JSON.stringify({status:r.status,text:await r.text()}));"
        return json.loads(
            dc(
                "exec",
                "-T",
                "web",
                "node",
                "--input-type=module",
                "-e",
                script,
                input=json.dumps({"url": url, "method": method, "data": data}),
            )
        )

    def graphql(query):
        response = internal("http://inngest:8288/v0/gql", "POST", {"query": query})
        if response["status"] != 200:
            raise RuntimeError(f"GraphQL HTTP {response['status']}")
        result = json.loads(response["text"])
        if result.get("errors"):
            raise RuntimeError(str(result["errors"]))
        return result["data"]

    def receiver():
        result = internal("http://receiver:8889/evidence")
        return json.loads(result["text"])

    def submit(slug, version, key):
        started = time.monotonic()
        result = run(
            [
                "curl",
                "--silent",
                "--show-error",
                "--fail-with-body",
                "--noproxy",
                "*",
                "--cacert",
                str(installation / "deploy/app-tls/fullchain.pem"),
                "--resolve",
                f"{host}:{port}:127.0.0.1",
                "-X",
                "POST",
                f"https://{host}:{port}/api/forms/{slug}/submit",
                "-H",
                "Content-Type: application/json",
                "-H",
                f"Idempotency-Key: {key}",
                # The trusted ingress must replace this client-supplied value.
                "-H",
                "X-Form-Forge-Client-IP: 198.51.100.123",
                "--data-binary",
                json.dumps(
                    {"versionId": version, "values": {"name": "Synthetic acceptance"}}
                ),
            ]
        )
        result = json.loads(result)["data"]
        assert result["status"] == "accepted"
        return result["submissionId"], started

    def fixture(path):
        user, workspace, form, version, endpoint = [str(uuid.uuid4()) for _ in range(5)]
        slug = "acceptance-" + uuid.uuid4().hex[:12]
        schema = {
            "schemaVersion": 1,
            "title": "Acceptance",
            "fields": [
                {
                    "id": str(uuid.uuid4()),
                    "key": "name",
                    "label": "Name",
                    "type": "shortText",
                    "required": True,
                    "width": "full",
                }
            ],
            "settings": {
                "submitLabel": "Submit",
                "successTitle": "Thank you",
                "successMessage": "Received",
            },
        }
        # Independent fixture setup, not an authentication test or a production bypass.
        crypto_code = "const {createCipheriv,randomBytes}=await import('node:crypto');const iv=randomBytes(12);const c=createCipheriv('aes-256-gcm',Buffer.from(process.env.WEBHOOK_ENCRYPTION_KEY,'base64'),iv);let s='';for await(const x of process.stdin)s+=x;const b=Buffer.concat([c.update(s,'utf8'),c.final()]);console.log(`v1.${iv.toString('base64url')}.${c.getAuthTag().toString('base64url')}.${b.toString('base64url')}`)"
        encrypted = dc(
            "exec",
            "-T",
            "web",
            "node",
            "--input-type=module",
            "-e",
            crypto_code,
            input=keys["RECEIVER_SECRET"],
        )
        sensitive_values.add(encrypted)
        execute(f"""begin;
insert into users(id,email) values ({quote(user)},{quote(slug + "@form-forge.invalid")});
insert into workspaces(id,name,slug) values ({quote(workspace)},'Acceptance',{quote(slug)});
insert into memberships(workspace_id,user_id,role) values ({quote(workspace)},{quote(user)},'owner');
insert into forms(id,workspace_id,created_by,name,slug,status,draft_schema) values
({quote(form)},{quote(workspace)},{quote(user)},'Acceptance',{quote(slug)},'published',{quote(json.dumps(schema))});
insert into form_versions(id,form_id,version_number,schema,schema_hash,published_by) values
({quote(version)},{quote(form)},1,{quote(json.dumps(schema))},{quote(hashlib.sha256(json.dumps(schema).encode()).hexdigest())},{quote(user)});
update forms set published_version_id={quote(version)} where id={quote(form)};
insert into webhook_endpoints(id,form_id,name,url,secret_ciphertext) values
({quote(endpoint)},{quote(form)},'Receiver',{quote("https://receiver.form-forge.invalid" + path)},{quote(encrypted)});
commit;""")
        return slug, version

    def state(submission):
        return sql(
            f"select id,status,attempt_count,manual_retry_count,next_attempt_at,locked_until from webhook_deliveries where submission_id={quote(submission)}"
        )

    def completed(submission):
        rows = state(submission)
        return (
            rows if rows and all(row["status"] == "succeeded" for row in rows) else None
        )

    def save_scenario(name, submission, started, initial=None):
        rows = completed(submission)
        assert rows and len(rows) == 1
        delivery = rows[0]
        attempts = sql(
            f"select attempt_number,status,http_status,error_code,started_at,completed_at from delivery_attempts where delivery_id={quote(delivery['id'])} order by attempt_number"
        )
        received = [row for row in receiver() if row["deliveryId"] == delivery["id"]]
        assert received and all(
            row["signatureValid"] and row["timestampValid"] and row["idValid"]
            for row in received
        )
        assert len({row["bodySha256"] for row in received}) == 1
        assert (
            delivery["attempt_count"] == len(attempts)
            and delivery["manual_retry_count"] == 0
        )
        report["scenarios"][name] = {
            "submissionId": submission,
            "delivery": delivery,
            "attempts": attempts,
            "outbox": sql(
                f"select id,type,status,attempts,sent_at from outbox_events where aggregate_id in ({quote(submission)},{quote(delivery['id'])}) order by created_at"
            ),
            "receiver": received,
            "elapsedSeconds": round(time.monotonic() - started, 2),
            "observedPending": initial,
        }

    destination_project = project + "-destination"
    destination_compose = None
    destination_owned = False

    def transfer(command, path, write=False):
        with path.open("wb" if write else "rb") as stream:
            result = subprocess.run(
                command,
                env=environment,
                check=False,
                stdout=stream if write else subprocess.PIPE,
                stdin=None if write else stream,
                stderr=subprocess.PIPE,
                timeout=120,
            )
        if result.returncode:
            raise RuntimeError(
                "Backup/restore store command failed: " + result.stderr.decode()[-2000:]
            )

    def inspect_project(name):
        ids = run(
            [
                "docker",
                "ps",
                "-aq",
                "--filter",
                "label=com.docker.compose.project=" + name,
            ]
        ).splitlines()
        return json.loads(run(["docker", "inspect", *ids])) if ids else []

    scheduler_run_ids = set()

    def redis_state():
        raw = dc(
            "exec",
            "-T",
            "redis",
            "sh",
            "-c",
            'REDISCLI_AUTH="$REDIS_PASSWORD" exec redis-cli --json "$@"',
            "diagnostic",
            "EVAL",
            REDIS_CONTENT,
            "0",
        )
        return redis_metadata(raw, scheduler_run_ids)

    def cron_runs():
        result = graphql(
            "{ stream(query:{limit:100,includeInternalEvents:true}) { id trigger type createdAt runs { id status startedAt finishedAt function { slug } } } }"
        )
        return [
            r
            for item in result["stream"]
            for r in item.get("runs") or []
            if r.get("function", {}).get("slug") == "form-forge-drain-outbox"
            and r["status"] == "COMPLETED"
        ]

    try:
        provenance = ROOT.parent / "SOURCE.json"
        report["commit"] = (
            json.loads(provenance.read_text())["commit"]
            if provenance.exists()
            else run(["git", "-C", str(ROOT.parent), "rev-parse", "HEAD"])
        )
        report["sourceHashes"] = source_record["files"]
        report["workingTree"] = source_record.get(
            "workingTree", "packaged committed revision"
        )
        report["docker"] = run(["docker", "version", "--format", "{{.Server.Version}}"])
        report["compose"] = run(["docker", "compose", "version", "--short"])
        report["architecture"] = run(
            ["docker", "info", "--format", "{{.OSType}}/{{.Architecture}}"]
        )
        dc("config", "--quiet")
        print("Building locked images on empty build stages", flush=True)
        dc("build", "--no-cache", "web", "migrate")
        print("Installing into new project volumes", flush=True)
        dc("up", "-d", "--wait", "postgres", "redis", "receiver")
        # Standalone must enforce the existing production contract, before listening.
        rejected = []
        for key, value in [
            ("INNGEST_DEV", "1"),
            ("TRUST_PROXY", "0"),
            ("E2E_PIPELINE_TOKEN", "a" * 32),
            ("NEXT_PUBLIC_APP_URL", "https://another.form-forge.invalid"),
        ]:
            invalid = subprocess.run(
                [*compose, "run", "--rm", "--no-deps", "-e", f"{key}={value}", "web"],
                env=environment,
                capture_output=True,
                text=True,
                timeout=30,
                check=False,
            )
            assert invalid.returncode != 0 and (
                "Invalid production configuration" in invalid.stderr
                or "differs from the build" in invalid.stderr
            )
            rejected.append(key)
        report["startupGuardsRejected"] = rejected
        dc("up", "-d", "web")
        unready = subprocess.run(
            [*compose, "exec", "-T", "web", "node", "scripts/readiness.mjs"],
            env=environment,
            capture_output=True,
            text=True,
            check=False,
        )
        assert unready.returncode != 0
        report["unmigratedDatabaseNotReady"] = True
        dc("run", "--rm", "migrate")
        migrations = sql(
            "select id,hash,created_at from drizzle.__drizzle_migrations order by id"
        )
        assert len(migrations) == 6
        dc("run", "--rm", "migrate")
        assert (
            sql(
                "select id,hash,created_at from drizzle.__drizzle_migrations order by id"
            )
            == migrations
        )
        report["migrations"] = {"count": len(migrations), "reapplyUnchanged": True}
        dc("up", "-d", "--wait")
        functions = wait(
            "three signed functions registered",
            lambda: graphql("{ functions { slug url triggers { type value } } }").get(
                "functions"
            ),
        )
        assert {row["slug"] for row in functions} == {
            "form-forge-process-submission",
            "form-forge-process-webhook-delivery",
            "form-forge-drain-outbox",
        }
        report["functions"] = functions
        assert internal("http://web:3000/api/inngest", "POST", {})["status"] in (
            401,
            403,
        )
        report["unsignedInvocationRejected"] = True
        assert (
            internal(
                "https://receiver.form-forge.invalid/invalid",
                "POST",
                {"id": str(uuid.uuid4())},
            )["status"]
            == 401
        )
        report["receiverRejectsUnsignedRequest"] = True
        settings = dc(
            "exec",
            "-T",
            "redis",
            "sh",
            "-c",
            'REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli --raw CONFIG GET appendonly appendfsync maxmemory-policy',
        )
        assert "yes" in settings and "always" in settings and "noeviction" in settings
        report["redisPersistence"] = settings.splitlines()

        # A: submission transaction while the scheduler is actually stopped.
        slug, version = fixture("/success")
        dc("stop", "inngest")
        submission, started = submit(slug, version, "scheduler-outage")
        atomic = sql(
            f"select (select count(*) from submissions where id={quote(submission)}) as submissions, (select count(*) from outbox_events where aggregate_id={quote(submission)} and status='pending') as outbox"
        )
        assert atomic == [{"submissions": 1, "outbox": 1}]
        assert state(submission) == []
        # Verify the rate-limit fingerprint came from nginx, not the supplied IP.
        import hmac

        spoof = hmac.new(
            keys["FINGERPRINT_SECRET"].encode(), b"198.51.100.123", "sha256"
        ).hexdigest()
        assert sql(
            f"select fingerprint_hash={quote(spoof)} as spoofed from submissions where id={quote(submission)}"
        ) == [{"spoofed": False}]
        report["clientIpSpoofRejected"] = True
        dc("start", "inngest")
        wait("outage recovery by minute cron", lambda: completed(submission))
        save_scenario("A_scheduler_outage", submission, started, atomic)

        if not args.cold_restore_only:
            # B + D: a persisted retry survives graceful restart of real Inngest.
            slug, version = fixture("/retry")
            submission, started = submit(slug, version, "retry-and-scheduler-restart")
            pending = wait(
                "503 persisted and retry scheduled",
                lambda: next(
                    (
                        r
                        for r in state(submission)
                        if r["status"] == "pending"
                        and r["attempt_count"] == 1
                        and r["next_attempt_at"]
                    ),
                    None,
                ),
            )
            dc("restart", "inngest")
            wait(
                "retry after graceful scheduler restart", lambda: completed(submission)
            )
            save_scenario("B_D_retry_scheduler_restart", submission, started, pending)
            assert [
                r["http_status"]
                for r in report["scenarios"]["B_D_retry_scheduler_restart"]["attempts"]
            ] == [503, 200]

            # C: receiver durably records the first request but withholds its ACK.
            # Kill only this disposable web worker after observing HTTP acceptance.
            slug, version = fixture("/hold")
            submission, started = submit(slug, version, "application-lease-recovery")
            pending = wait(
                "receiver has accepted request with ACK withheld",
                lambda: next(
                    (
                        r
                        for r in receiver()
                        if r["path"] == "/hold" and r["response"] == "withheld"
                    ),
                    None,
                ),
            )
            leased = state(submission)
            assert (
                len(leased) == 1
                and leased[0]["status"] == "processing"
                and leased[0]["locked_until"]
            )
            dc("kill", "-s", "SIGKILL", "web")
            dc("start", "web")
            wait("lease expiry and real cron redelivery", lambda: completed(submission))
            save_scenario("C_application_restart_lost_ack", submission, started, leased)
            attempts = report["scenarios"]["C_application_restart_lost_ack"]["attempts"]
            assert (
                attempts[0]["error_code"] == "WORKER_LEASE_EXPIRED"
                and attempts[1]["http_status"] == 200
            )
            assert (
                len(report["scenarios"]["C_application_restart_lost_ack"]["receiver"])
                == 2
            )

            before_restart = sql(
                "select (select count(*) from submissions) as submissions, (select count(*) from delivery_attempts) as attempts"
            )
            dc("restart", "postgres", "redis")
            wait(
                "PostgreSQL and Redis restart with application data retained",
                lambda: (
                    sql(
                        "select (select count(*) from submissions) as submissions, (select count(*) from delivery_attempts) as attempts"
                    )
                    == before_restart
                ),
            )
            dc("up", "-d", "--wait")
            report["storageRestartRetainedCounts"] = before_restart

        cron = graphql(
            "{ stream(query:{limit:100,includeInternalEvents:true}) { id trigger type createdAt runs { id status startedAt finishedAt function { slug } } } }"
        )
        completed_cron_runs = [
            run
            for item in cron["stream"]
            for run in item.get("runs") or []
            if run.get("function", {}).get("slug") == "form-forge-drain-outbox"
            and run["status"] == "COMPLETED"
        ]
        assert completed_cron_runs
        report["completedRecoveryCronRuns"] = completed_cron_runs
        report["versions"] = {
            service: run(
                [
                    "docker",
                    "image",
                    "inspect",
                    image,
                    "--format",
                    "{{json .RepoDigests}}",
                ]
            )
            for service, image in {
                "node": "node:24.21.0-bookworm-slim",
                "postgres": "postgres:16.14-bookworm",
                "redis": "redis:7.4.8-bookworm",
                "inngest": "inngest/inngest:v1.46.0",
                "nginx": "nginx:1.30.5-trixie",
            }.items()
        }

        # One maintenance boundary contains C (existing completed history), B
        # (new retry), and A (new submission while Inngest is stopped).
        cold = {"backupStartedAt": None, "expected": {}, "negativeControls": {}}
        report["scenarios"]["E_full_cold_restore"] = cold
        completed_id = report["scenarios"]["A_scheduler_outage"]["submissionId"]
        completed_delivery = completed(completed_id)[0]
        slug, version = fixture("/retry")
        retry_submission, retry_started = submit(slug, version, "cold-retry")
        retry_pending = wait(
            "cold backup retry has persisted 503 and due time",
            lambda: next(
                (
                    r
                    for r in state(retry_submission)
                    if r["status"] == "pending"
                    and r["attempt_count"] == 1
                    and r["next_attempt_at"]
                ),
                None,
            ),
        )
        scheduler_before = graphql(
            "{ functions { id slug url triggers { type value } } stream(query:{limit:100,includeInternalEvents:true}) { id runs { id status function { slug } } } }"
        )
        scheduler_run_ids = {
            r["id"]
            for item in scheduler_before["stream"]
            for r in item.get("runs") or []
        }
        dc("stop", "inngest")
        slug, version = fixture("/success")
        pending_submission, pending_started = submit(
            slug, version, "cold-pending-outbox"
        )
        atomic = sql(
            f"select (select count(*) from submissions where id={quote(pending_submission)}) as submissions, (select count(*) from outbox_events where aggregate_id={quote(pending_submission)} and status='pending') as outbox"
        )
        if atomic != [{"submissions": 1, "outbox": 1}] or state(pending_submission):
            raise RuntimeError("Cold pending submission/outbox is not atomic")
        if state(retry_submission) != [retry_pending]:
            raise RuntimeError("Retry advanced before backup boundary")
        # Quiesce application writers before Redis diagnostic snapshot. backup.sh
        # itself still stops and verifies all four services before copying stores.
        dc("stop", "ingress", "web")
        expected = {name: sql(query) for name, query in INVARIANTS.items()}
        redis_before_at = time.monotonic()
        redis_before = redis_state()
        cold.update(
            {
                "expected": expected,
                "atomicPending": atomic,
                "pendingSubmissionId": pending_submission,
                "retrySubmissionId": retry_submission,
                "completedSubmissionId": completed_id,
                "schedulerBefore": scheduler_before,
                "retryAtBoundary": retry_pending,
                "receiverBefore": json.loads(
                    run(
                        [
                            *compose,
                            "exec",
                            "-T",
                            "receiver",
                            "node",
                            "--input-type=module",
                            "-e",
                            "console.log(await(await fetch('http://localhost:8889/evidence')).text())",
                        ],
                        env=environment,
                    )
                ),
            }
        )
        backup = directory / "backup"
        cold["backupStartedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        backup_environment = {
            **environment,
            "COMPOSE_PROJECT_NAME": project,
            "COMPOSE_FILE": "deploy/compose.yaml"
            + os.pathsep
            + "deploy/acceptance/compose.yaml",
        }
        run(
            ["sh", str(installation / "deploy/backup.sh"), str(backup)],
            env=backup_environment,
        )
        cold["backupArtifactHashes"] = verify_backup(backup)
        cold["backupBoundary"] = json.loads((backup / "BACKUP.json").read_text())
        dc("stop", "postgres")
        source_containers = inspect_project(project)
        if any(
            c["State"]["Running"]
            for c in source_containers
            if c["Config"]["Labels"]["com.docker.compose.service"] != "receiver"
        ):
            raise RuntimeError("Source writers or PostgreSQL are still running")

        # Corruption is rejected before creating any destination resources.
        corrupt = directory / "corrupt-backup"
        shutil.copytree(backup, corrupt)
        with (corrupt / "scheduler-queue.tar.gz").open("ab") as stream:
            stream.write(b"corrupt-control")
        try:
            verify_backup(corrupt)
        except ValueError as error:
            cold["negativeControls"]["corruptArchive"] = {
                "refused": True,
                "reason": str(error),
                "destinationStarted": False,
            }
        else:
            raise RuntimeError("Corrupted archive was accepted")
        if inspect_project(destination_project):
            raise RuntimeError(
                "Destination unexpectedly exists before checksum verification"
            )
        # Only backed-up configuration and this same frozen release are used.
        destination_deploy = destination_installation / "deploy"
        shutil.copyfile(backup / "installation.env", destination_deploy / ".env")
        shutil.copytree(backup / "tls", destination_deploy / "tls")
        shutil.copytree(backup / "receiver-tls", destination_deploy / "receiver-tls")
        shutil.copytree(backup / "tls", destination_deploy / "app-tls")
        for name in cold["backupBoundary"]["composeFiles"]:
            shutil.copyfile(
                backup / "configuration" / name, destination_installation / name
            )
        restored_keys = dict(
            line.split("=", 1)
            for line in (destination_deploy / ".env").read_text().splitlines()
        )
        restored_keys.update(
            {"ACCEPTANCE_DIR": str(destination_deploy), "HTTPS_PORT": "19443"}
        )
        (destination_deploy / ".env").write_text(
            "\n".join(f"{k}={v}" for k, v in restored_keys.items()) + "\n"
        )
        (destination_deploy / ".env").chmod(0o600)
        # Keep the same controlled receiver alive. Its observations/ordinals are
        # external experiment state, explicitly retained across restore.
        receiver_network = project + "_receiver-fixture"
        overlay = destination_deploy / "acceptance/compose.yaml"
        text = overlay.read_text()
        text = (
            text[: text.index("\nnetworks:")]
            + "\nnetworks:\n  receiver-fixture:\n    external: true\n    name: "
            + receiver_network
            + "\n"
        )
        overlay.write_text(text)
        destination_compose = [
            "docker",
            "compose",
            "--env-file",
            str(destination_deploy / ".env"),
            "-p",
            destination_project,
            "-f",
            str(destination_deploy / "compose.yaml"),
            "-f",
            str(overlay),
        ]
        source_volumes = [
            project + "_" + n
            for n in ("application-data", "scheduler-history", "scheduler-queue")
        ]
        destination_volumes = [
            destination_project + "_" + n
            for n in ("application-data", "scheduler-history", "scheduler-queue")
        ]
        destination_owned = claim_new_destination(
            project,
            destination_project,
            source_volumes,
            destination_volumes,
            run(["docker", "volume", "ls", "-q"]).splitlines(),
        )
        verify_backup(backup)
        source_compose = compose
        compose = destination_compose
        dc("config", "--quiet")
        # Create stopped services/volumes, inspect emptiness, then follow the
        # published pg_restore + complete-directory tar extraction procedure.
        dc("create", "--no-build", "postgres", "redis", "inngest")
        for service, path in (
            ("postgres", "/var/lib/postgresql/data"),
            ("inngest", "/var/lib/inngest"),
            ("redis", "/data"),
        ):
            listing = dc(
                "run",
                "--rm",
                "--no-deps",
                "-T",
                "--entrypoint",
                "sh",
                service,
                "-c",
                'find "$1" -mindepth 1 -print',
                "empty-check",
                path,
            )
            if listing:
                raise RuntimeError("Destination volume is not empty: " + service)
        cold["destinationInitiallyEmpty"] = destination_volumes
        dc("up", "-d", "--wait", "postgres")
        transfer(
            [
                *compose,
                "exec",
                "-T",
                "postgres",
                "pg_restore",
                "-U",
                "form_forge",
                "-d",
                "form_forge",
                "--no-owner",
                "--exit-on-error",
            ],
            backup / "application.dump",
        )
        for service, path, name in (
            ("inngest", "/var/lib/inngest", "scheduler-history.tar.gz"),
            ("redis", "/data", "scheduler-queue.tar.gz"),
        ):
            transfer(
                [
                    *compose,
                    "run",
                    "--rm",
                    "--no-deps",
                    "-T",
                    "--entrypoint",
                    "sh",
                    service,
                    "-c",
                    f"cd {path} && tar -xzf -",
                ],
                backup / name,
            )
            copied = directory / (service + "-restored.tar.gz")
            transfer(
                [
                    *compose,
                    "run",
                    "--rm",
                    "--no-deps",
                    "-T",
                    "--entrypoint",
                    "tar",
                    service,
                    "-C",
                    path,
                    "-czf",
                    "-",
                    ".",
                ],
                copied,
                write=True,
            )
            expected_files = archive_files((backup / name).read_bytes())
            if archive_files(copied.read_bytes()) != expected_files:
                raise RuntimeError("Scheduler directory restore mismatch: " + service)
            cold.setdefault("schedulerRestoredFiles", {})[service] = expected_files
        cold["sqliteRestored"] = sqlite_metadata(
            (directory / "inngest-restored.tar.gz").read_bytes()
        )
        if cold["sqliteRestored"] != sqlite_metadata(
            (backup / "scheduler-history.tar.gz").read_bytes()
        ):
            raise RuntimeError("SQLite identities/history mismatch")
        if (
            not cold["sqliteRestored"]["apps"]
            or len(cold["sqliteRestored"]["functions"]) != 3
            or not cold["sqliteRestored"]["trace_runs"]
        ):
            raise RuntimeError("Restored scheduler lacks registration/run history")
        restored = {name: sql(query) for name, query in INVARIANTS.items()}
        if restored != expected:
            raise RuntimeError("Application invariants changed during restore")
        cold["restoredBeforeWorkers"] = restored
        decrypt_command = [
            "run",
            "--rm",
            "--no-deps",
            "-T",
            "--entrypoint",
            "node",
            "web",
            "--input-type=module",
            "-e",
            DECRYPT,
        ]
        cold["decryption"] = json.loads(
            dc(*decrypt_command, input=keys["RECEIVER_SECRET"])
        )
        wrong_env = directory / "wrong-key.env"
        wrong_keys = {
            **restored_keys,
            "WEBHOOK_ENCRYPTION_KEY": base64.b64encode(
                secrets.token_bytes(32)
            ).decode(),
        }
        sensitive_values.add(wrong_keys["WEBHOOK_ENCRYPTION_KEY"])
        wrong_env.write_text(
            "\n".join(f"{k}={v}" for k, v in wrong_keys.items()) + "\n"
        )
        wrong_env.chmod(0o600)
        wrong_compose = list(compose)
        wrong_compose[wrong_compose.index("--env-file") + 1] = str(wrong_env)
        rejected = subprocess.run(
            [*wrong_compose, *decrypt_command],
            input=keys["RECEIVER_SECRET"],
            text=True,
            capture_output=True,
            env=environment,
            check=False,
            timeout=60,
        )
        if (
            rejected.returncode != 42
            or "secret decryption refused" not in rejected.stdout
        ):
            raise RuntimeError("Wrong encryption key was not refused by decryption")
        cold["negativeControls"]["wrongEncryptionKey"] = {
            "refused": True,
            "exitCode": rejected.returncode,
            "deliveryProcessingStarted": False,
        }
        dc("up", "-d", "--wait", "redis")
        cold["redisRestored"] = compare_redis(
            redis_before, redis_state(), (time.monotonic() - redis_before_at) * 1000
        )
        dc("create", "--no-build", "web", "ingress")
        cold["isolation"] = inspect_isolation(
            source_containers,
            inspect_project(destination_project),
            project,
            destination_project,
            installation,
            destination_installation,
            receiver_network,
        )
        receiver_before = cold["receiverBefore"]
        started_restore = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        cold["workersStartedAt"] = started_restore
        dc("up", "-d", "--wait", "web", "inngest", "ingress")
        cold["isolation"] = inspect_isolation(
            inspect_project(project),
            inspect_project(destination_project),
            project,
            destination_project,
            installation,
            destination_installation,
            receiver_network,
        )
        restored_functions = wait(
            "restored scheduler registration",
            lambda: graphql("{ functions { id slug url triggers { type value } } }")[
                "functions"
            ],
        )
        if sorted(restored_functions, key=lambda r: r["id"]) != sorted(
            scheduler_before["functions"], key=lambda r: r["id"]
        ):
            raise RuntimeError("Restored function identities changed")
        cold["restoredFunctions"] = restored_functions
        if internal("http://web:3000/api/inngest", "POST", {})["status"] not in (
            401,
            403,
        ):
            raise RuntimeError("Unsigned invocation accepted after restore")
        wait(
            "cold pending outbox delivered by real cron",
            lambda: completed(pending_submission),
        )
        wait(
            "cold retry delivered under restored logical ID",
            lambda: completed(retry_submission),
        )
        save_scenario(
            "F_cold_pending_outbox", pending_submission, pending_started, atomic
        )
        save_scenario(
            "G_cold_pending_retry", retry_submission, retry_started, retry_pending
        )
        retry_final = completed(retry_submission)[0]
        if (
            retry_final["id"] != retry_pending["id"]
            or retry_final["manual_retry_count"] != 0
            or retry_final["attempt_count"] != 2
        ):
            raise RuntimeError("Restored retry identity/budget changed")
        if [
            r["http_status"]
            for r in report["scenarios"]["G_cold_pending_retry"]["attempts"]
        ] != [503, 200]:
            raise RuntimeError("Restored retry lost attempt history")
        # Require two completed ticks after both pending deliveries finish. Observe
        # C throughout this bounded interval, separately checking logical rows and HTTP.
        prior_cron_ids = {r["id"] for r in cron_runs()}
        observation_started = time.monotonic()

        def observed_two_ticks():
            if completed(completed_id) != [completed_delivery]:
                raise RuntimeError("Completed logical delivery changed")
            observations = [
                r for r in receiver() if r["deliveryId"] == completed_delivery["id"]
            ]
            original = [
                r
                for r in receiver_before
                if r["deliveryId"] == completed_delivery["id"]
            ]
            if observations != original:
                raise RuntimeError(
                    "Completed delivery received an unexpected HTTP replay in observation window"
                )
            fresh = [r for r in cron_runs() if r["id"] not in prior_cron_ids]
            return fresh if len(fresh) >= 2 else None

        fresh_crons = wait(
            "two additional completed recovery ticks without completed-delivery replay",
            observed_two_ticks,
            timeout=240,
        )
        cold["completedObservation"] = {
            "delivery": completed_delivery,
            "seconds": round(time.monotonic() - observation_started, 2),
            "completedCronRuns": fresh_crons,
            "newLogicalDelivery": False,
            "httpRepeatsObserved": 0,
        }
        cold["newCompletedRecoveryCronRuns"] = [
            r for r in cron_runs() if r["startedAt"] >= started_restore
        ]
        if not cold["newCompletedRecoveryCronRuns"]:
            raise RuntimeError("No completed cron after restore")
        final_invariants = {name: sql(query) for name, query in INVARIANTS.items()}
        for name in ("schemas", "endpoints"):
            if final_invariants[name] != expected[name]:
                raise RuntimeError("Restored configuration changed: " + name)
        if {r["id"] for r in final_invariants["submissions"]} != {
            r["id"] for r in expected["submissions"]
        }:
            raise RuntimeError("Unexpected new/missing submission")
        final_attempts = {r["id"]: r for r in final_invariants["attempts"]}
        if any(final_attempts.get(r["id"]) != r for r in expected["attempts"]):
            raise RuntimeError("Restored attempt history changed after processing")
        for delivery in expected["deliveries"]:
            if (
                delivery["status"] == "succeeded"
                and delivery not in final_invariants["deliveries"]
            ):
                raise RuntimeError("Previously completed logical delivery changed")
        cold["finalInvariants"] = final_invariants
        cold["receiverAfter"] = receiver()
        invocation_stream = graphql(
            "{ stream(query:{limit:100,includeInternalEvents:true}) { id runs { id status startedAt finishedAt function { slug } eventID } } }"
        )
        invocations = [
            r
            for item in invocation_stream["stream"]
            for r in item.get("runs") or []
            if r["status"] == "COMPLETED" and r["finishedAt"] >= started_restore
        ]
        # In 1.46.0 FunctionRun.event omits ExternalID; the root event resolver
        # loads it. Use the documented internal event ID to obtain metadata only.
        for invocation in invocations:
            invocation["event"] = graphql(
                "{ event(query:{eventId:"
                + json.dumps(invocation["eventID"])
                + "}) { id externalID name } }"
            )["event"]
        cold["signedInvocationEvidence"] = invocations
        pending_event_ids = {
            r["id"]
            for r in expected["outbox"]
            if r["aggregate_id"] == pending_submission
        }
        retry_event_ids = {
            r["id"]
            for r in final_invariants["outbox"]
            if r["aggregate_id"] == retry_pending["id"]
        }
        for slug, event_ids in (
            ("form-forge-process-submission", pending_event_ids),
            ("form-forge-process-webhook-delivery", retry_event_ids),
        ):
            if not any(
                r["function"]["slug"] == slug
                and (r.get("event") or {}).get("externalID") in event_ids
                for r in invocations
            ):
                raise RuntimeError("Missing completed restored invocation: " + slug)
        cold["signedInvocationEvidence"] = invocations
        cold["restoredHistoryRunIds"] = sorted(scheduler_run_ids)
        cold["newRecoveryRunIds"] = sorted(
            {r["id"] for r in invocations} - scheduler_run_ids
        )
        cold["scheduling"] = {
            "retryDueAt": retry_pending["next_attempt_at"],
            "mechanism": "application pending outbox/due-delivery recovery via real minute cron; no pre-created Inngest sleeping retry claimed",
        }
        # Signed SDK invocations completed the real application functions; these
        # assertions combine signature rejection with persisted HTTPS/HMAC results.
        cold["signedInvocationsCompleted"] = True
        report["status"] = "passed"
    except (Exception, KeyboardInterrupt) as error:
        report["status"] = "failed"
        report["error"] = redact(str(error)) or "Acceptance interrupted"
        raise
    finally:
        print("Cleaning only this disposable project", flush=True)
        cleanups = {}
        if destination_owned:
            cleanups[destination_project] = cleanup_resources(
                run,
                lambda *a, **k: run(
                    [*destination_compose, "--profile", "fixture", *a],
                    env=environment,
                    **k,
                ),
                destination_project,
            )
        cleanups[project] = cleanup_resources(
            run,
            lambda *a, **k: run(
                [
                    "docker",
                    "compose",
                    "--env-file",
                    str(env_file),
                    "-p",
                    project,
                    "-f",
                    str(installation / "deploy/compose.yaml"),
                    "-f",
                    str(installation / "deploy/acceptance/compose.yaml"),
                    "--profile",
                    "fixture",
                    *a,
                ],
                env=environment,
                **k,
            ),
            project,
        )
        cleanup = {
            "passed": all(c["passed"] for c in cleanups.values()),
            "projects": cleanups,
        }
        report["finishedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        # Detect accidental retention even on failure paths, then persist only a
        # redacted failure report. Bodies/signatures are never collected here.
        try:
            serialized = json.dumps(report)
        except (TypeError, ValueError):
            save_report(
                report, args.output, cleanup
            )  # Writes failed fallback and raises.
            raise
        redacted = redact(serialized)
        if redacted != serialized:
            report = json.loads(redacted)
            report["status"] = "failed"
            report["error"] = (
                "Secret found in report; redacted evidence and refused success"
            )
            save_report(report, args.output, cleanup)
            raise SystemExit(1)
        save_report(report, args.output, cleanup)
        print(f"Evidence: {args.output}", flush=True)
