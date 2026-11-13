# Invoke Workflow and In/Out arguments

```powershell
node tests/invoke-workflow/launch.cjs
```

The suite uses temporary `.rpa.json` files, real read-only file resolution, isolated storage, and a real browser Get Text fixture. Full UI tests mock licensing and native activity calls; they do not contact Runway. The fixture Save records content in memory and never overwrites even the temporary source workflows. Workspace working files are not opened or modified. Chrome must be installed at its standard Windows path.

## Using Invoke Workflow

1. In the called workflow, declare arguments in Data Manager → Arguments with direction **In** or **Out** and a supported type. Defaults are also used as local inputs when debugging the file independently. Save it as `.rpa.json`.
2. Add **Invoke Workflow** to the caller. In Properties, browse to the file or enter a path, then choose **Import / refresh arguments**. Relative paths resolve from the calling workflow's folder; an unsaved caller needs an absolute path.
3. Map In arguments using `{{callerVariable}}` (typed value), a literal string, or JSON text for numeric/Boolean/collection values. Full Watch expressions such as `{{items[0].name}}` are allowed. A whole-value template preserves the value's type; interpolated text remains authored text and is converted for the declared type. Nested JSON object literals do not interpolate their string members; use a whole-variable template to pass structured runtime data.
4. Map Out arguments to bare caller variable/argument names. Outputs may create new runtime variables. An empty/unmapped Out is ignored. **Use child default** removes an In mapping; explicitly entering an empty String is a supplied value.
5. Run, Debug or use Test Explorer. Caller and callee variables are isolated. Values are JSON-copied on entry/return; no shared mutable collections cross the boundary. Only a successfully completed, type-validated call transfers Out values. Errors and Stop leave caller destinations unchanged.

Supported arguments: String, Boolean, finite numeric primitives (integer types require safe whole numbers and applicable ranges), ISO DateTime strings, Object containing plain JSON data, Array/List and typed List<T>/T[] collections. Custom .NET objects, executable values, getters, sparse arrays, nonfinite numbers and InOut direction are not supported. Argument names must be unique, valid and distinct from local variable names. Required In values need a mapping or nonempty default. Out arguments start with their declared default or a type default (empty String, zero, false, empty list, null Object, epoch DateTime). Out types are checked before returning.

Local root Run/Debug now initializes declared arguments too; Test Explorer accepts In argument overrides alongside declared variables. Arguments persist in the current workspace session and remain part of saved workflow JSON.

## Debug, history and analysis

- **Step Into** enters the called file; **Step Over** stays at caller depth unless a saved/session child breakpoint is hit. Continue and Stop act on the shared call stack. Called files show a read-only source view and their own Locals & Watch. Session breakpoint toggles never write files. Returning restores the caller view and locals.
- Every actual call has a separate Run History entry with parent/root identifiers, caller activity, depth, sanitized In/Out snapshots, activity steps and errors. Use **Called** / **Caller** links to navigate. History still retains its last 20 runs; old caller links may therefore expire. Test assertions stay on the root test run after mapped outputs return.
- Analyzer checks mapping references and output producers locally, then reads dependencies for missing files, malformed definitions, required inputs, unknown mappings, unsupported types, recursive calls and errors inside called workflows. Dependency findings navigate to the owning Invoke activity. Reanalyze after changing a called file on disk; file checks reflect the last explicit analysis. No activities run during these checks.

Dependencies are read and snapshotted before execution, including nested calls. Editing a dependency file mid-run does not replace its prepared definition. Paths must be static `.rpa.json` paths. Recursive calls are rejected; dependency inspection is bounded to 100 call references and 16 levels. Files are limited to 5 MB and 2,000 activities. Individual argument data is bounded to 500 KB, 20,000 values and depth 20.

This feature executes local Studio files. Runway/Robot dependency bundling and remote file deployment are not implemented; Analyzer reports this publishing limitation (WA305). Existing nested-container restrictions remain; a called workflow may use root containers, and Invoke itself can run inside supported container bodies. Extract to Workflow and interactive editing of called files during Debug are outside this change.

Coverage: relative native paths and invalid files; linked runs and typed root/child arguments; deep copy and collection validation; preflight with zero side effects; nested paths, cycles and snapshots; Step Into/Over, saved/session breakpoints, scoped Locals and return; Stop/failure without partial outputs; credential aliases; dependency analysis; Test Explorer; real Get Text; full UI browse/import/mappings, source view, history links, persisted arguments, dark/light/compact layouts and unchanged fixture files.
