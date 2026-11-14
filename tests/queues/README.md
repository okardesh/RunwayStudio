# Queues and transaction processing

Open **Queues** in Studio's toolbar or bottom panel. It uses the environment selected for local Run/Debug in **Assets**. The Maestro RPA page has the same **Queues** management tab. Create a queue, configure retries/delay/lease duration, add JSON work with a unique business reference, and inspect item status, attempt, retry count and error reason. Environment queues are separate even when their names match.

Use the **Queues** activity category:

1. **Add Queue Item** accepts a static queue name, reference and JSON object or object variable. An identical reference with identical content returns the existing item; different content is rejected.
2. **Get Transaction Item** atomically claims one ready item. It returns a transaction object (`transaction.content`, `transaction.reference`, etc.) and an optional Boolean `hasTransaction`. Empty queues return `null` and `false`; branch before processing.
3. **Set Transaction Status** commits `Successful`, or `Failed` with `Application` / `Business` and a reason. It accepts only a transaction claimed by the current run, including within called workflows. Application failures retry up to the queue limit after its configured delay. Business failures are final. Setting an item Failed does not throw a workflow exception: its handling activity can succeed while its transaction is failed/retrying.

Studio and Robot automatically renew active claims. Stop, workflow failure and a successful run that forgot to commit release unfinished claims as Application failures; the latter run reports an error. If cleanup cannot reach Maestro, lease expiry recovers work on the next queue inspection or claim. A lost renewal stops further processing at an activity boundary. Native activities already executing are allowed to return. Lease ownership receipts stay private to the run and never appear in workflow variables, packages or Run History.

Delivery is **at least once**. Atomic claims prevent two valid leases for one item; they cannot roll back an external payment, file write or other side effect after a process crash. Use the business reference as an idempotency key in external systems. Retry Scope retries activities and is separate from queue item retries. Claim mutation retries reuse their operation ID when an acknowledgement is lost. Completed request records are retained to make recovery safe.

Portable packages retain static queue references. Maestro checks that referenced queues exist and are enabled in the selected Robot Jobs environment before dispatch. Robot queue access requires its registered key plus the private job capability and the package operation allowlist. Child workflows share the same queue session. Run History displays transaction metadata for both local and Robot runs; raw item content and private receipts are omitted from transaction events. Known protected asset values are rejected in queue payloads/references and masked in failure reasons.

The **Dispatcher** and **Performer** sample downloads create new files. Dispatcher accepts In `reference` and `payload`. Performer claims one item and branches on availability. **Replace its placeholder log with business processing before using real work**; the sample commits success after that placeholder.

## Maestro installation

```powershell
node server/install-maestro-robot-jobs.cjs C:/path/to/Maestro --update
```

The installer adds `maestro_queues.py`, updates the Robot Jobs/assets adapters, adds the Maestro Queues tab and allows `X-Runway-Queue-Session` in CORS. Review existing adapter differences before `--update`. Rebuild/restart Maestro's API and frontend; frozen Python bundles must include `maestro_queues`. Existing workflow files are not used for migration. Queue tables are additive in the existing SQLite database. Back up `studio-queues.key` beside that database: it supports private claim acknowledgement recovery. The management API follows Maestro's existing administrative key and tenant policy.

Routes: `GET /api/v1/studio-queues`, `POST /api/v1/studio-queues/configure`, `POST /api/v1/studio-queues/operate`, and the job-scoped `POST /api/v1/robot-jobs/:id/queues/operate`.

## Verification

```powershell
node tests/queues/launch.cjs
node tests/robot-jobs/launch.cjs --maestro-source=C:/path/to/Maestro/script_server.py --assets --queues
npm.cmd run build
npm.cmd --prefix Robot run build
```

Tests use isolated temporary SQLite databases, workflow fixtures and browser profiles. They cover concurrent claims, deduplication/conflicts, empty queues, lost acknowledgements, stop during uncertain claims, private receipts, fencing, renewal, expiry, retry exhaustion/delay, Business errors, environment isolation, grants, local execution/history, Robot HTTP execution and persisted results, and integrated Studio Dark/Light/compact layouts.
