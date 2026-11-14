# Human tasks and durable approval waits

Studio's **Human Tasks** activity category adds **Create Human Task** and **Wait for Human Task**. Review tasks from **Tasks** in Studio's toolbar/bottom panel or **Human Tasks** on Maestro's RPA page.

## First workflow

1. Place **Create Human Task** at the main workflow root. Set its title, static assignee (`user:onur` or `role:finance`), JSON review context, form schema and timeout (1–10,080 minutes). Use output `approvalTask`.
2. Place **Wait for Human Task** at the main root with `{{approvalTask}}` and output `approval`.
3. Branch on `{{approval.decision}} == "Approved"`; handle `Rejected` and `TimedOut` explicitly. `approval.fields` holds typed form answers. The result also contains the actor, comment and completion time.
4. Invoke processing workflows **after** the wait. Obtain credentials and open application/browser sessions after approval; native handles and application sessions are not checkpointed.

Example form schema:

```json
[
  { "name": "costCenter", "label": "Cost center", "type": "String", "required": true },
  { "name": "amount", "label": "Confirmed amount", "type": "Number", "required": true },
  { "name": "verified", "label": "Documents verified", "type": "Boolean", "required": false }
]
```

Form schemas support up to 20 unique fields. Approval requires mandatory fields; rejection allows omitted fields. Supplied values must match their types. Review context and schema are immutable after task creation. Decisions are atomic: a competing or late decision cannot overwrite an existing result. A lost response can be recovered with **Recover decision**, using the same request ID.

## Identity and audit

An administrative Maestro connection can view tenant tasks and manage operators. Decisions require a **personal task token**; an administrative key alone cannot approve. In **Operator administration**, create an ID/display name and roles, then issue a token. The token is displayed once, masked, and stored only as a hash on Maestro. Updating an operator rotates its token; disabled operators cannot decide. Users can act on tasks addressed to their own ID or current roles. Actor identity comes from the token, not editable form data. Decisions, creation, waits and timeouts have tenant-scoped audit records.

Enter the personal token for the current panel session. It is not saved in browser preferences, workflow files, packages or Run History. Switching away from the Tasks panel clears its in-memory token. Maestro's existing administrative API-key and tenant policy still applies; this feature adds separate per-operator decision authorization.

## Durable execution

Publish a portable package and start it through **Robot Jobs**. At a Wait boundary, the Robot snapshots safe JSON variables and the next root activity, then releases its worker. Maestro stores the checkpoint in the existing SQLite database, tied to the original package, environment, job and task. The same Robot can perform other jobs while approval is pending. A background resumer processes approvals, rejections and timeouts, retrying an unavailable Robot with the same checkpoint ID.

After response, the same job resumes after its Wait; earlier activities and task creation are not replayed. The pinned package is retained independently of later publication changes. Robot and Maestro restarts while waiting are supported. Job status is `waiting`, and Run History retains the creation/wait/decision/resume trail. Polling resumes when Studio reopens.

Before a resumed job performs native work, the Robot durably records checkpoint acceptance. A duplicate resume returns its existing status. If the Robot crashes after accepting resumed work, that receipt is surfaced as a failed job requiring review of external effects; the body is not automatically replayed. This is not an exactly-once guarantee for external systems. Use idempotency keys for external writes.

If the checkpoint callback is unacknowledged, the Robot retains the safe checkpoint in its private journal and re-reports the same checkpoint after reconnect/restart. Public job status never includes variable state or capability tokens. Back up Maestro's database and `studio-human.key`, and retain the Robot's `human-job-receipts` directory with its user profile. Do not delete/roll back acceptance receipts to force a replay. Protect application data with normal OS access controls and use TLS for production connections.

**First-version boundaries:** both human activities must be top-level in the main workflow, outside loops, called workflows and Transaction Scope. Complete/release all queue claims before waiting. JSON values are checkpointed; credentials, secret-named nonempty fields, known protected values, native handles, cyclic values and oversized state are rejected. Read credentials after approval or clear sensitive variables before waiting. A timeout returns `TimedOut` to the workflow; it is not implicitly an approval or a workflow failure.

**Stop** cancels pending tasks and requests cooperative Robot cancellation. If the Robot is offline, the job remains `stopping` until cancellation can be confirmed. Durable cancellation receipts prevent a late resume from starting work.

## Local Debug

Local **Run** fails preflight for human workflows before executing activities. Use Robot Jobs for durable execution. Local **Debug** simulates Create/Wait, using the Wait activity's **Debug mock decision** and JSON fields. It creates no real task and submits no real approval. Inspect `approval` in Locals & Watch, add breakpoints after the Wait and exercise each branch. Debug history labels these events as mock responses. Robot Jobs always uses real tasks and ignores Debug mock settings.

## Installation and verification

The Maestro installer adds `maestro_human_tasks.py`, the management tab, and the `X-Runway-Task-Token` CORS header. Rebuild/restart both API and UI; frozen Python builds must include `maestro_human_tasks`. Tables are additive; existing workflow files are not used for migration. The active Mac development build was updated and tested.

```powershell
node server/install-maestro-robot-jobs.cjs C:/path/to/Maestro --update
node tests/human-tasks/launch.cjs
node tests/robot-jobs/launch.cjs --human-tasks --maestro-source=C:/path/to/Maestro/script_server.py
npm.cmd run build
npm.cmd --prefix Robot run build
```

Tests use temporary databases, profiles and workflow fixtures. They cover roles, typed forms, competing/idempotent decisions, timeouts, cancellation, server/Robot restarts, unacknowledged checkpoints, duplicate resume, interrupted accepted work, protected state, Debug/Watch/history and Studio Dark/Light/compact UI. Native live tests also restart Robot and Maestro during a pending approval and verify approval, rejection, real timeout and stop without replaying earlier actions.
