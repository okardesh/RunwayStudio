# Transaction Scope and automatic error handling

Add **Get Transaction Item**, then guard its `hasTransaction` output with an **If**. Inside that branch, add **Transaction Scope** and set **Claimed transaction** to `{{transaction}}`. The scope's **Do** block contains the processing activities or an Invoke Workflow call. Nested application, If, For Each and Try Catch blocks within the scope are rendered and executed recursively.

The scope automatically commits **Successful** when its body finishes. An unhandled **Business Rule Exception** commits **Failed / Business** with the resolved message, without retry or recovery. Other body failures commit **Failed / Application**; Maestro schedules the item's retry using the queue's configured limit and delay. A transaction failure handled by the scope can leave the overall workflow completed: check its transaction result/events to distinguish successful work from handled rejected work.

**After handled failure** selects **Continue** (run the next activity) or **Stop** (fail the workflow after recording the item result and any recovery). Neither setting replays the processing body. Queue retry remains a separate future claim; this scope processes one item per execution. An outer Retry Scope cannot replay an already finalized Transaction Scope, and Business Rule Exceptions bypass Retry Scope retries.

## Recovery workflow

Select an optional static `.rpa.json` file in **Recovery Workflow · Arguments**. Browse or import its In/Out declarations using the existing Invoke editor. For example, declare `error` as In Object and map it to `{{transactionError}}`; declare `transaction` as In Object and map it to `{{transaction}}`. The error object contains `type`, `message`, `itemId`, `reference`, and `attempt`. `transactionResult` contains the committed result, including `retry` or final `failed`. Output names are configurable, distinct, and cannot overwrite the claimed transaction variable.

Recovery runs **after an Application failure is committed**, even if its retry limit is exhausted. Use it to reset the target application or restore its session before the next transaction. Recovery does not change that item's recorded outcome. Business failures, successful items, uncertain status commits and user Stop do not start recovery. A failed recovery fails the workflow while preserving the original item result. Stop during recovery leaves its already committed failure intact.

Recovery files and their dependencies are validated before execution and included in portable packages, with typed In/Out mappings. Missing files, invalid mappings and recursive calls fail preflight. Recovery executes in a child frame: Debug supports breakpoints, Step Into/Over, call stack and Locals & Watch just as for Invoke Workflow. Run History and Robot Jobs show processing, automatic result, recovery start/completion/failure/stop and the attempt number, without private claim receipts.

## Ownership and interruption

Claim before the scope. Within its body or recovery, do not claim another item, nest a Transaction Scope, or call Set Transaction Status on the scope-owned item. The scope owns status management; these mistakes are rejected. Analyzer checks scope properties, ownership and recovery dependencies. Invoked workflows share the same private ownership guard.

Stop during processing skips auto-success and recovery; normal run cleanup releases the unfinished claim as an Application failure. Lease renewal/loss and uncertain commit recovery use the existing queue session. Commit uncertainty fails closed and retries only the same mutation ID, never the processing body. External effects are not rolled back: queue delivery remains **at least once**, so use the business reference to make external writes idempotent.

Known credential values and supported derived messages are masked in failure reasons, history, logs and Debug. Log Message can inspect safe object properties such as `{{transaction.content.amount}}` and `{{transactionError.message}}` using the read-only Watch grammar; it does not evaluate arbitrary code.

## Verification

```powershell
node tests/transaction-scope/launch.cjs
node tests/robot-jobs/launch.cjs --maestro-source=C:/path/to/Maestro/script_server.py --assets --queues --transaction-scope
npm.cmd run build
npm.cmd --prefix Robot run build
```

The isolated suites cover auto-commit, typed Business/Application exceptions across Invoke, queue retries, portable recovery mappings, recovery failure, processing/recovery Stop, lost commit acknowledgements, ownership conflicts, Analyzer, Debug/Watch, Studio Dark/Light/compact UI, production Robot HTTP dispatch and persistent Maestro transaction results. Test fixtures live in new OS temporary directories and do not use existing working files.

Maestro needs the updated `maestro_queues.py` to grant the scope's implicit `complete` operation. Apply the existing `server/install-maestro-robot-jobs.cjs` installer to the intended Maestro source and rebuild/restart its API. The active Mac development installation was updated and tested during implementation.
