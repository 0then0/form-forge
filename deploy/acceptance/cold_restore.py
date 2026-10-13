"""Bounded cold-restore evidence helpers for the pinned acceptance fixture."""

import hashlib
import io
import json
import sqlite3
import tarfile
import tempfile
from pathlib import Path
from urllib.parse import urlparse

INVARIANTS = {
    "schemas": "select id,form_id,schema_hash,md5(schema::text) as digest from form_versions order by id",
    "submissions": "select id,form_id,form_version_id,delivery_status from submissions order by id",
    "endpoints": "select id,form_id,url,enabled,archived_at from webhook_endpoints order by id",
    "outbox": "select id,aggregate_id,type,status,attempts,available_at,sent_at from outbox_events order by id",
    "deliveries": "select id,submission_id,endpoint_id,status,attempt_count,manual_retry_count,next_attempt_at,locked_until from webhook_deliveries order by id",
    "attempts": "select id,delivery_id,attempt_number,status,http_status,error_code,started_at,completed_at from delivery_attempts order by id",
}

# Same v1 AES-GCM format as integration/webhooks/crypto.ts. Runs as a one-off
# process before workers; only counts/refusal leave the container, never secrets.
DECRYPT = r"""
const {Pool}=await import('pg');
const {createDecipheriv,timingSafeEqual}=await import('node:crypto');
let expected=''; for await(const chunk of process.stdin) expected+=chunk;
const pool=new Pool({connectionString:process.env.DATABASE_URL});
try {
  const {rows}=await pool.query('select secret_ciphertext from webhook_endpoints');
  if(!rows.length) throw Error('no endpoints');
  for(const row of rows) {
    const [v,i,t,b]=row.secret_ciphertext.split('.');
    if(v!=='v1'||!i||!t||!b) throw Error('format');
    const c=createDecipheriv('aes-256-gcm',Buffer.from(process.env.WEBHOOK_ENCRYPTION_KEY,'base64'),Buffer.from(i,'base64url'));
    c.setAuthTag(Buffer.from(t,'base64url'));
    const plain=Buffer.concat([c.update(Buffer.from(b,'base64url')),c.final()]);
    const wanted=Buffer.from(expected);
    if(plain.length!==wanted.length||!timingSafeEqual(plain,wanted)) throw Error('secret mismatch');
  }
  console.log(JSON.stringify({endpoints:rows.length,decrypted:true}));
} catch {
  console.log('secret decryption refused'); process.exitCode=42;
} finally { await pool.end(); }
"""

# Diagnostic, version-specific enumeration. Values can contain scheduler event
# data; the caller immediately hashes them and never reports the raw response.
REDIS_CONTENT = """
local result={}
local keys=redis.call('KEYS','*')
table.sort(keys)
for _,key in ipairs(keys) do
  local kind=redis.call('TYPE',key).ok
  local value
  if kind=='string' then value=redis.call('GET',key)
  elseif kind=='hash' then
    value={}; local fields=redis.call('HKEYS',key); table.sort(fields)
    for _,field in ipairs(fields) do table.insert(value,field); table.insert(value,redis.call('HGET',key,field)) end
  elseif kind=='set' then value=redis.call('SMEMBERS',key); table.sort(value)
  elseif kind=='zset' then value=redis.call('ZRANGE',key,0,-1,'WITHSCORES')
  elseif kind=='list' then value=redis.call('LRANGE',key,0,-1)
  elseif kind=='stream' then value=redis.call('XRANGE',key,'-','+')
  else return redis.error_reply('Unsupported diagnostic Redis type') end
  table.insert(result,{key,kind,redis.call('PTTL',key),value})
end
return result
"""


def redis_metadata(raw, run_ids=()):
    def category(key):
        if "{queue}" in key:
            return "queue"
        if any(
            token in key
            for token in (":metadata:", ":actions:", ":bulk-events:", ":stack:")
        ):
            return "run-state"
        return "other-scheduler-state"

    return {
        hashlib.sha256(key.encode()).hexdigest(): {
            "type": kind,
            "ttlMs": ttl,
            "runIds": sorted(run_id for run_id in run_ids if run_id in key),
            "category": category(key),
            "valueSha256": hashlib.sha256(
                json.dumps(value, sort_keys=True).encode()
            ).hexdigest(),
        }
        for key, kind, ttl, value in json.loads(raw)
    }


def compare_redis(before, after, elapsed_ms):
    required = {
        key: value
        for key, value in before.items()
        if value["ttlMs"] == -1 or value["ttlMs"] > elapsed_ms + 1000
    }
    if not required:
        raise ValueError("No surviving scheduler Redis state to verify")
    for key, value in required.items():
        if key not in after or any(
            after[key][field] != value[field] for field in ("type", "valueSha256")
        ):
            raise ValueError("Scheduler Redis state was not restored")
    if set(after) - set(before):
        raise ValueError("Unexpected Redis state before workers")
    return {
        "verifiedKeys": len(required),
        "expiredOrNearExpiryKeys": len(before) - len(required),
        "before": before,
        "after": after,
    }


def archive_files(content):
    with tarfile.open(fileobj=io.BytesIO(content)) as archive:
        return {
            m.name.removeprefix("./"): hashlib.sha256(
                archive.extractfile(m).read()
            ).hexdigest()
            for m in archive
            if m.isfile()
        }


def sqlite_metadata(content):
    with tempfile.TemporaryDirectory(prefix="ff-sqlite-evidence-") as temporary:
        directory = Path(temporary)
        with tarfile.open(fileobj=io.BytesIO(content)) as archive:
            # Archive has already passed backup_manifest.verify's path/type checks.
            for member in archive:
                if member.isfile():
                    target = directory / member.name
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(archive.extractfile(member).read())
        database = directory / "main.db"
        connection = sqlite3.connect(f"file:{database}?mode=ro", uri=True)
        try:
            if connection.execute("pragma integrity_check").fetchall() != [("ok",)]:
                raise ValueError("Restored SQLite integrity check failed")
            identity_columns = {
                "apps": ["id", "name", "url"],
                "functions": ["id", "app_id", "name", "slug"],
                "events": ["hex(internal_id)", "event_id", "event_name"],
                "function_runs": ["hex(run_id)", "function_id", "trigger_type"],
                "history": ["hex(id)", "hex(run_id)", "type", "attempt"],
                "trace_runs": [
                    "run_id",
                    "function_id",
                    "status",
                    "queued_at",
                    "started_at",
                    "ended_at",
                ],
            }
            return {
                table: [
                    [
                        value.hex() if isinstance(value, bytes) else value
                        for value in row
                    ]
                    for row in connection.execute(
                        f"select {','.join(columns)} from {table} order by 1,2"
                    )
                ]
                for table, columns in identity_columns.items()
            }
        finally:
            connection.close()


def claim_new_destination(
    source_project,
    destination_project,
    source_volumes,
    destination_volumes,
    existing_volumes,
):
    """Grant cleanup ownership only after refusing pre-existing destination stores."""
    if source_project == destination_project or len(set(destination_volumes)) != 3:
        raise ValueError("Destination must be a separate project with three new stores")
    if set(source_volumes) & set(destination_volumes):
        raise ValueError("Source storage reuse refused")
    if set(destination_volumes) & set(existing_volumes):
        raise ValueError("Destination stores are not new")
    return True


def inspect_isolation(
    source,
    destination,
    source_project,
    destination_project,
    source_directory,
    destination_directory,
    receiver_network,
):
    def stores(containers):
        return {
            m["Name"] for c in containers for m in c["Mounts"] if m["Type"] == "volume"
        }

    source_stores, destination_stores = stores(source), stores(destination)
    if len(destination_stores) != 3 or source_stores & destination_stores:
        raise ValueError("Source storage reuse or missing destination store")
    source_ids = {c["Id"] for c in source}
    checks = []
    for container in destination:
        if (
            container["Id"] in source_ids
            or container["Config"]["Labels"]["com.docker.compose.project"]
            != destination_project
        ):
            raise ValueError("Source container reuse refused")
        for mount in container["Mounts"]:
            if mount["Type"] == "bind":
                path = Path(mount["Source"]).resolve()
                if (
                    Path(source_directory).resolve() == path
                    or Path(source_directory).resolve() in path.parents
                ):
                    raise ValueError("Source installation mount reuse refused")
                if Path(destination_directory).resolve() not in path.parents:
                    raise ValueError("Unexpected destination bind mount")
        networks = set(container["NetworkSettings"]["Networks"])
        if networks - {destination_project + "_default", receiver_network}:
            raise ValueError("Source service network reuse refused")
        env = dict(
            value.split("=", 1) for value in container["Config"]["Env"] if "=" in value
        )
        for variable, hostname, port, path in (
            ("DATABASE_URL", "postgres", 5432, "/form_forge"),
            ("INNGEST_REDIS_URI", "redis", 6379, "/0"),
            ("INNGEST_BASE_URL", "inngest", 8288, ""),
        ):
            if variable in env:
                address = urlparse(env[variable])
                if (address.hostname, address.port, address.path) != (
                    hostname,
                    port,
                    path,
                ):
                    raise ValueError("Unexpected application/scheduler service address")
        checks.append(
            {
                "container": container["Name"],
                "mounts": [
                    {k: m[k] for k in ("Type", "Source", "Destination")}
                    for m in container["Mounts"]
                ],
                "networks": sorted(networks),
            }
        )
    for container in source:
        if (
            container["State"]["Running"]
            and container["Config"]["Labels"]["com.docker.compose.service"]
            != "receiver"
        ):
            raise ValueError("Source installation is still running")
    return {
        "sourceProject": source_project,
        "destinationProject": destination_project,
        "sourceVolumes": sorted(source_stores),
        "destinationVolumes": sorted(destination_stores),
        "containers": checks,
        "sourceStopped": True,
        "onlySharedBoundary": receiver_network,
    }
