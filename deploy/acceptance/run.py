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
import subprocess
import tempfile
import time
import uuid
from pathlib import Path

from cleanup import cleanup_resources, save_report

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--output", type=Path, default=ROOT / "evidence/local.json")
args = parser.parse_args()
project = "ff-acceptance-" + uuid.uuid4().hex[:10]
host = "forms.acceptance.invalid"
port = 18443
report = {
    "project": project,
    "startedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    "scenarios": {},
}


def run(command, *, input=None, env=None, check=True):
    result = subprocess.run(
        command, input=input, text=True, capture_output=True, env=env, check=False
    )
    if check and result.returncode:
        # Commands never include owner secrets; do not echo runtime environment.
        raise RuntimeError(
            f"Command failed: {' '.join(command)}\n{result.stderr[-4000:]}"
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
    (directory / "evidence").mkdir()
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
        "ACCEPTANCE_DIR": str(directory),
        "HTTPS_BIND": "127.0.0.1",
        "HTTPS_PORT": str(port),
    }
    env_file = directory / ".env"
    env_file.write_text(
        "\n".join(f"{key}={value}" for key, value in keys.items()) + "\n"
    )
    env_file.chmod(0o600)
    for folder, name in [
        ("app-tls", host),
        ("receiver-tls", "receiver.form-forge.invalid"),
    ]:
        tls = directory / folder
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
    environment = {**os.environ, "BUILDX_CONFIG": str(directory / "buildx")}
    compose = [
        "docker",
        "compose",
        "--env-file",
        str(env_file),
        "-p",
        project,
        "-f",
        str(ROOT / "compose.yaml"),
        "-f",
        str(ROOT / "acceptance/compose.yaml"),
    ]

    def dc(*command, input=None, check=True):
        return run([*compose, *command], input=input, env=environment, check=check)

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
                str(directory / "app-tls/fullchain.pem"),
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

    restore_container = project + "-restore"
    restore_volume = project + "-restore-data"
    try:
        provenance = ROOT.parent / "SOURCE.json"
        report["commit"] = (
            json.loads(provenance.read_text())["commit"]
            if provenance.exists()
            else run(["git", "-C", str(ROOT.parent), "rev-parse", "HEAD"])
        )
        report["sourceHashes"] = {
            str(path.relative_to(ROOT.parent)): hashlib.sha256(
                path.read_bytes()
            ).hexdigest()
            for path in [
                ROOT.parent / "Dockerfile",
                ROOT.parent / ".dockerignore",
                ROOT / "acceptance/cleanup.py",
                ROOT / "compose.yaml",
                ROOT / "nginx.conf.template",
                ROOT / "acceptance/run.py",
                ROOT / "acceptance/compose.yaml",
                ROOT.parent / "apps/web/scripts/start.mjs",
                ROOT.parent / "apps/web/scripts/readiness.mjs",
                ROOT.parent / "apps/web/scripts/acceptance-receiver.mjs",
            ]
        }
        report["workingTree"] = (
            run(["git", "-C", str(ROOT.parent), "status", "--porcelain"])
            if not provenance.exists()
            else "packaged committed revision"
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
        wait("retry after graceful scheduler restart", lambda: completed(submission))
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
            len(report["scenarios"]["C_application_restart_lost_ack"]["receiver"]) == 2
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
        cron_runs = [
            run
            for item in cron["stream"]
            for run in item.get("runs") or []
            if run.get("function", {}).get("slug") == "form-forge-drain-outbox"
            and run["status"] == "COMPLETED"
        ]
        assert cron_runs
        report["completedRecoveryCronRuns"] = cron_runs
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

        # E: add pending work with scheduler stopped, then quiesce the source.
        dc("stop", "inngest")
        slug, version = fixture("/success")
        restored_submission, _ = submit(slug, version, "pending-at-backup")
        snapshot = sql(
            "select (select count(*) from form_versions) as versions, (select count(*) from submissions) as submissions, (select count(*) from webhook_endpoints) as endpoints, (select count(*) from outbox_events where status='pending') as pending"
        )
        schemas = sql(
            "select id,schema_hash,md5(schema::text) as digest from form_versions order by id"
        )
        dc("stop", "ingress", "web")
        backup = directory / "application.dump"
        with backup.open("wb") as destination:
            subprocess.run(
                [
                    *compose,
                    "exec",
                    "-T",
                    "postgres",
                    "pg_dump",
                    "-U",
                    "form_forge",
                    "-d",
                    "form_forge",
                    "-Fc",
                ],
                stdout=destination,
                check=True,
                env=environment,
            )
        run(
            [
                "docker",
                "run",
                "-d",
                "--name",
                restore_container,
                "--network",
                project + "_default",
                "--env-file",
                str(env_file),
                "-e",
                "POSTGRES_USER=form_forge",
                "-e",
                "POSTGRES_DB=form_forge",
                "-v",
                restore_volume + ":/var/lib/postgresql/data",
                "postgres:16.14-bookworm",
            ]
        )
        wait(
            "isolated restore database ready",
            lambda: (
                subprocess.run(
                    [
                        "docker",
                        "exec",
                        restore_container,
                        "pg_isready",
                        "-U",
                        "form_forge",
                    ],
                    capture_output=True,
                    check=False,
                ).returncode
                == 0
            ),
        )
        with backup.open("rb") as source:
            subprocess.run(
                [
                    "docker",
                    "exec",
                    "-i",
                    restore_container,
                    "pg_restore",
                    "-U",
                    "form_forge",
                    "-d",
                    "form_forge",
                    "--no-owner",
                    "--exit-on-error",
                ],
                stdin=source,
                check=True,
                capture_output=True,
            )
        override = directory / "restore.yaml"
        override.write_text(
            "services:\n  web:\n    environment:\n      DATABASE_URL: postgresql://form_forge:${POSTGRES_PASSWORD}@"
            + restore_container
            + ":5432/form_forge\n"
        )
        compose.extend(["-f", str(override)])
        dc("up", "-d", "--wait", "web", "ingress")
        # Query the isolated destination via pg in web without emitting decrypted secrets.
        verify = "const{Pool}=await import('pg');const{createDecipheriv}=await import('node:crypto');const p=new Pool({connectionString:process.env.DATABASE_URL});const r=await p.query(\"select secret_ciphertext from webhook_endpoints\");for(const x of r.rows){const[v,i,t,b]=x.secret_ciphertext.split('.');if(v!=='v1')throw Error('version');const c=createDecipheriv('aes-256-gcm',Buffer.from(process.env.WEBHOOK_ENCRYPTION_KEY,'base64'),Buffer.from(i,'base64url'));c.setAuthTag(Buffer.from(t,'base64url'));c.update(Buffer.from(b,'base64url'));c.final()}const s=await p.query(\"select (select count(*) from form_versions)::int as versions,(select count(*) from submissions)::int as submissions,(select count(*) from webhook_endpoints)::int as endpoints,(select count(*) from outbox_events where status='pending')::int as pending\");console.log(JSON.stringify(s.rows));await p.end()"
        restored = json.loads(
            dc("exec", "-T", "web", "node", "--input-type=module", "-e", verify)
        )
        assert restored == snapshot
        restored_schemas = json.loads(
            dc(
                "exec",
                "-T",
                "web",
                "node",
                "--input-type=module",
                "-e",
                "const{Pool}=await import('pg');const p=new Pool({connectionString:process.env.DATABASE_URL});const r=await p.query('select id,schema_hash,md5(schema::text) as digest from form_versions order by id');console.log(JSON.stringify(r.rows));await p.end()",
            )
        )
        assert schemas == restored_schemas
        # Retain matching scheduler history/queue, resume the scheduler unchanged.
        dc("start", "inngest")
        wait(
            "pending restored outbox reaches receiver",
            lambda: any(
                r["path"] == "/success"
                and r["deliveryId"]
                not in {s["delivery"]["id"] for s in report["scenarios"].values()}
                for r in receiver()
            ),
        )

        def restored_completed():
            result = json.loads(
                dc(
                    "exec",
                    "-T",
                    "web",
                    "node",
                    "--input-type=module",
                    "-e",
                    "const{Pool}=await import('pg');const p=new Pool({connectionString:process.env.DATABASE_URL});const r=await p.query(\"select id,status,attempt_count from webhook_deliveries where submission_id='"
                    + restored_submission
                    + "'\");console.log(JSON.stringify(r.rows));await p.end()",
                )
            )
            return (
                result
                if len(result) == 1 and result[0]["status"] == "succeeded"
                else None
            )

        result = wait("restored attempt result committed", restored_completed)
        report["scenarios"]["E_isolated_restore"] = {
            "snapshotCounts": snapshot,
            "restoredCounts": restored,
            "endpointSecretsDecrypt": True,
            "pendingSubmissionId": restored_submission,
            "delivery": result,
            "schemaHashes": restored_schemas,
            "scheduler": "retained matching SQLite and Redis volumes; not a scheduler snapshot restore",
        }
        report["status"] = "passed"
    except Exception as error:
        report["status"] = "failed"
        report["error"] = str(error)
        raise
    finally:
        print("Cleaning only this disposable project", flush=True)
        cleanup = cleanup_resources(run, dc, project, restore_container, restore_volume)
        save_report(report, args.output, cleanup)
        print(f"Evidence: {args.output}", flush=True)
