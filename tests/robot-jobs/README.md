# Robot Jobs

Open **Jobs** in Studio’s toolbar (or **Robot Jobs** in the bottom panel), refresh the catalog, select an online Robot and an exact published package version, enter In arguments and select **Start job**. Non-string inputs use JSON, for example `42`, `true` or `["A","B"]`. Jobs run the published immutable package, including its invoked workflows and UI targets. Studio does not save or change the open workflow.

The selected job shows live status/logs, returned Out arguments and invoked workflow results. **View in Run History** opens the saved result. **Stop job** cancels queued work immediately; running work changes to `stopping`, finishes its current native activity, then stops before another activity starts. This is cooperative cancellation: a native activity that has not returned must finish or reach its own timeout. Stopping does not roll back effects of completed activities.

Monitoring continues while other tabs are open. Network errors preserve the last confirmed status and do not restart jobs. If a launch acknowledgement is lost, use **Recover launch**, which reuses the same request ID. Studio resumes monitoring retained job descriptors from its Run History after reload. Credentials are not saved in history; sensitive argument fields and known secret values are masked. Logs are bounded to the latest 300 entries.

## Runway integration requirement

The Runway server lives in [`okardesh/Maestro`](https://github.com/okardesh/Maestro). Its existing `script_server.py` supplies the registered Robot/license and published package repositories and the `rpa_jobs` table. Studio expects the following authenticated API contract; publishing alone does not provide these endpoints. A server without this API shows an explicit unavailable message.

| Method | Route | Request / response |
| --- | --- | --- |
| GET | `/api/v1/robot-jobs/catalog` | `{ok:true,schemaVersion:1,robots:[{id,name,online}],packages:[{workflowId,name,version,packageId,inputArguments}]}` |
| POST | `/api/v1/robot-jobs` | `{requestId,robotId,workflowId,version,packageId,inputs}` → `{ok:true,jobId}` |
| GET | `/api/v1/robot-jobs/:jobId` | `{ok:true,job:{jobId,status,startedAt,completedAt?,logs,outputs?,error?,package?,workflowCalls?}}` |
| POST | `/api/v1/robot-jobs/:jobId/stop` | Same job snapshot, with stop acknowledged |

Studio sends its existing `X-API-Key` and `X-Tenant-Id`. The adapter follows Maestro's existing public administrative API key/tenant policy; it does not turn that global key into a limited per-tenant credential. All job/package/Robot lookups are tenant-filtered. Deploy behind the host's existing API access controls. Catalog arguments are the package root’s declared In arguments, including their type/default/required metadata.

[`server/maestro_robot_jobs.py`](../../server/maestro_robot_jobs.py) implements the production routes using Maestro's actual repositories and SQLite schema (Python standard library only). Robot URLs and keys stay server-side. The installer adds two small GET/POST dispatch hooks to `script_server.py` and copies this module next to it. It rejects an unrecognized handler layout or an existing differing module before writing anything. Run it against the intended Maestro source checkout, review those two files and rebuild/restart Maestro:

```powershell
node server/install-maestro-robot-jobs.cjs C:/path/to/Maestro
```

The current working copy's `maestro_robot_jobs.py` must be included next to `script_server.py` in the Maestro server build. PyInstaller follows the added ordinary import. If Runway is behind a proxy, configure its existing `RUNWAY_PUBLIC_URL` to the same reachable origin Robot connects to, such as `http://10.211.55.2:5050`. The installer does not modify workflows, user data, API keys or the live server. It has been verified against an isolated copy of Maestro's real source; it has **not** been applied to the live Runway deployment in this task.

The adapter pins the exact published version/hash, checks typed inputs, reserves the request ID before contacting Robot, prevents conflicting request reuse and proxies status/stop using the registered Robot key. Robot validates the full package checksum/graph before native actions. An ambiguous dispatch is never automatically sent again. Its `/api/v1/robot-jobs/:id/complete` callback accepts the Robot's redacted final snapshot, including `stopped`, and persists outputs/package/call metadata. Existing legacy trigger/callback routes remain available.

The adapter stores durable request/job tickets and snapshots in the additive `studio_robot_jobs` SQLite table; a unique tenant/request key and a transaction prevent duplicate dispatch across server restarts/processes. Job status/logs/outputs are also mirrored into Maestro's existing `rpa_jobs` table. Credentials and raw sensitive inputs are not stored in the new table. Robot retains the latest 20 jobs in memory and accepts at most 10 queued jobs; after Robot restart or eviction, nonterminal status is reported unavailable instead of guessing a result or replaying actions. A completed result remains available from Maestro's database after Robot restart.

## Robot listener additions

The existing authenticated `POST /api/robot/jobs` submission route remains compatible. `GET /api/robot/jobs/:jobId` reads a snapshot; `POST /api/robot/jobs/:jobId/stop` requests an idempotent stop. All require the registered Robot’s key, and callbacks must belong to its connected Runway origin. Duplicate job IDs are accepted only with identical submitted content; changing content under an existing ID is rejected.

Statuses are `queued`, `running`, `stopping`, `stopped`, `success`, `failed`. Logs include a monotonic `sequence`, ISO `timestamp`, `level` and `message`. Full retained snapshots replace previous ones in Studio, avoiding log duplication on polling/reconnection. Completion callbacks include package version/hash and nested workflow results where execution completed successfully. Stopped or failed calls do not transfer partial Out arguments.

## Verification

```powershell
node tests/robot-jobs/launch.cjs
node tests/portable-publish/launch.cjs
npm.cmd run build
npm.cmd --prefix Robot run build
```

The Robot Jobs suite uses the production HTTP listener with mocked Electron/native activity boundaries, a local Runway gateway and headless Chrome. It verifies live logs before completion, success/failure/nested Out results in Run History, typed inputs, pinned packages, authentication/tenant isolation, duplicate prevention, queued/cooperative stop, cancellation during retry, masked secrets, lost launch acknowledgement recovery, reconnect/reload monitoring and Dark/Light/compact layouts. Fixtures, profiles and screenshots are created only in a new OS temporary directory. It does not connect to a real Runway account or modify existing workflow files.

To additionally test the production Python adapter against Maestro's real table/repository functions, supply a read-only source snapshot and a Python 3.12 executable (the bundled runtime is detected on this machine):

```powershell
node tests/robot-jobs/launch.cjs --maestro-source=C:/path/to/Maestro/script_server.py
```

This repeats the full Studio/Robot UI scenarios with the Python adapter, then restarts the fixture server and verifies durable idempotency and results. It extracts only the required repository/schema functions via Python AST and uses a new temporary SQLite database; it does not import/start or alter the user's Maestro application.
