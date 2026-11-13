# Test Explorer

Run the regression suite from the repository root:

```powershell
node tests/test-explorer/launch.cjs
```

Dependencies must be installed and Chrome must be available at its standard Windows path. The suite bundles the production engine and full Studio UI into a temporary directory. It uses isolated local storage and temporary browser fixtures; it never opens or rewrites workspace workflows or contacts Runway. The UI fixture mocks the Electron activity bridge and fails if a test attempts to save a workflow. A separate engine fixture uses the production browser Get Text implementation against real HTML with two different input rows.

## Usage

1. Open the workflow and choose the **Test Explorer** bottom tab.
2. Create a test, name its first data row, and enter JSON input overrides for declared variables, for example `{"customer":"Ada"}`. Unspecified variables keep their canvas defaults.
3. Enter a JSON object mapping Watch expressions to expected values, for example `{"textResult":"Hello Ada","items.Count":2}`.
4. Add data rows with different inputs and expected values. Save the test, then choose **Run test** or **Run all** for the current workflow.
5. Open a recent result to inspect its assertions and activity timeline in **Run History**. Expected and actual values appear separately. Execution errors, assertion mismatches, and stopped tests have distinct statuses.

Expected values use strict types and deep JSON equality (object key order does not matter). Watch property/index/string-method expressions are supported; arbitrary code is not. An unavailable expression fails its assertion. Checks use the full runtime value, while displayed values are bounded previews with known credentials masked. Tests currently assert final runtime variables; workflow argument overrides, log assertions, expected exceptions, remote runners, and application state reset are not implemented.

Test definitions are stored separately on this device, associated with the workflow's saved path or its project name for an unsaved workflow. Save As creates a separate association. Test execution snapshots the current canvas, including unsaved edits, without saving or modifying workflow files. Each row receives fresh variable data. Native activities still operate on real applications; external application state is shared between rows. One workflow can execute at a time, and **Stop tests** stops after the current activity and skips remaining rows.

Limits: 50 saved tests / 500 KB total, 20 rows per test, 30 checks per row, 100 rows per batch. JSON fields are limited to 12,000 characters and bounded nesting. Test results share Run History's retention and storage limits (last 20 runs); test definitions persist independently of clearing history. Interrupted runs retain an interrupted execution status and a stopped test status after reload. Storage failures leave existing saved definitions intact.

Coverage: typed and deep assertions, persistence and quota failures, pass/fail rows and history metadata, preflight before side effects, workflow association, mutable default isolation, execution failures, cancellation, concurrency, credential masking, regular Run isolation, real Get Text data rows, and full UI create/edit/save/run/all/history linking/reload/revert/delete across dark/light and compact layouts.
