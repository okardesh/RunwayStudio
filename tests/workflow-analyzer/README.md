# Workflow Analyzer

Run from the repository root with dependencies installed:

```powershell
node tests/workflow-analyzer/launch.cjs
```

Chrome is required at its standard Windows installation path for the full UI fixture. All bundles, profiles and screenshots are created in a fresh temporary directory. The suite uses isolated local storage and a mocked connection to render Studio, never contacts Runway, and rejects any activity execution or workflow save from the analyzer.

## Usage

Choose **Analyze** in the Studio ribbon, press **F8**, or open **Errors → Analyze workflow**. Errors, warnings and informational findings have rule codes, affected activities/properties and suggested actions. Filter by severity or search for an activity, rule or issue. Select an activity finding or use **Show on canvas** to select the activity and expand its ancestors. Workflow and Data Manager findings have no activity to reveal.

Analysis is manual and runs against the current canvas, including unsaved edits. It does not run activities, evaluate user code, save workflows, contact applications, create Run History entries, or automatically gate Run/Debug/Test/Publish. Results stay in memory for the session. Semantic edits, workflow identity changes and UI target changes mark the previous report as out of date; reanalyze before navigating. Selection, folding and canvas position changes do not invalidate results.

## Rules and limits

- WA001–002: activity limit and empty workflow.
- WA101–103: unique activity IDs, unknown activities, and activities that currently fall back to simulated Studio execution.
- WA110–118: missing/cyclic parents, unsupported nested containers, missing/duplicate children and inconsistent ownership.
- WA120–126: IF / Try Catch branch structure, empty containers, loop variables and Break/Continue placement.
- WA130–140: missing desktop/application targets and missing shared selector bindings. Bound selector checks use the current target library.
- WA150–154: required properties, finite nonnegative numeric settings, integer retries, allowed options and variable-name properties.
- WA160–161: broken connection endpoints and the local executor's list-order semantics.
- WA200–209: variable/argument names and collisions, local argument initialization limits, read-before-output / conditional writes, loop scope, unknown explicit references, ambiguous bare Log Message references, unused declarations and unrecognized template syntax.

Output-producing activities can create variables without a declaration. The analyzer tracks these outputs in execution order; it merges guaranteed IF branch outputs and treats loop outputs as conditional. Explicit unresolved `{{variable}}` references are errors. An unknown bare Log Message identifier is only a warning because it may be intended as literal text. Quoted Log Message literals are not treated as references. Rule messages include variable names but never their values.

Static checks cannot establish whether a selector matches a live element, an application/file/server is available, a script is correct, a value has the expected runtime type, or a branch is reachable for every input. Arbitrary code and bare expressions outside Log Message are not interpreted. Use Debug and Test Explorer to verify runtime behavior. This is an analysis of the current Studio executor rather than a guarantee of Robot compatibility. The analyzer reports up to 500 findings and examines up to 2,000 activities; limits are visibly marked as incomplete results.

Coverage includes pure/no-side-effect analysis, default/required properties, numeric zero and Boolean false, variable output names, shared and desktop targets, dynamic outputs and branch/loop scope, duplicate declarations and argument caveats, topology errors and cycles, unsupported runtime cases, report signatures and limits. The full UI suite checks Analyze/F8, Errors filters/search, ancestor expansion/navigation, stale edits and targets, clean reanalysis, zero execution/save/history side effects, session reset, and dark/light/compact layouts.
