# Portable publishing and Robot packages

```powershell
node tests/portable-publish/launch.cjs
npm run build
npm --prefix Robot run build
```

Tests use a fresh temporary directory for workflow fixtures, downloads and fake Robot settings. They never modify existing workspace workflows or contact Runway. The production Robot listener runs against a local fake licensing/callback server with inert Electron adapters; no real license is consumed. A separate production browser Get Text test executes a packaged child after source workflow files are deleted. Chrome must be installed at its standard Windows path.

## Usage

In Studio Publish, choose **Prepare package**. Review the component list, target count, version and content ID. **Download package** exports the same definition as `.runway.json`; **Publish** sends it in the existing API's `definition` field. Publishing without preparation builds and validates automatically.

Only the current main canvas, reachable Invoke dependencies and referenced UI targets are collected. No directory is archived. Relative call paths are resolved read-only and replaced by `package://wf-N` identifiers. The current target library wins over saved snapshots. Conflicting snapshots without an authoritative entry and deleted library target IDs are rejected.

Preparation never saves source files. Canvas/version/library edits require refresh; disk edits to dependencies require explicit refresh too. A prepared snapshot can be retried unchanged after a network failure. Failed refresh discards the previous snapshot. Scripts, documents and other external activity inputs are not bundled; those paths/URLs remain application inputs.

## Format and runtime

The definition retains ordinary root nodes, edges, variables, arguments and targets, plus `portablePackage`: format `runway.portable-workflow`, schema version `1`, package version, SHA-256 content ID, entry ID, workflow definitions and referenced target catalog. The root mirror must match the entry. The checksum hashes canonical manifest JSON excluding its ID; it detects corruption and is not an authenticity signature.

The updated Robot validates the package and complete dependency graph before actions. Invalid checksums, missing definitions, cycles, local workflow paths, unsupported schemas/activities and invalid argument mappings fail the job. Invoke resolution uses only the in-memory package, never Robot workflow files.

In/Out values share Studio's typed JSON conversion and deep-copy helpers. Child frames are isolated; only a successful, type-valid return copies outputs into the caller. Parent catch/retry blocks can handle child errors without partial output writes. Robot supports sequence, IF, For Each with scope restoration, Try Catch/Finally, Retry Scope and collection controls.

Successful job callbacks include `outputs` (declared root Out values), `package: {id, version}` and `workflowCalls` (names, depths, statuses), alongside existing status/log fields. Failures have no partial output object. Logs identify the package/calls and redact known credential aliases. Declared Out results intentionally return actual data to the calling application.

Legacy single workflows and Log Message literals remain supported. Unbundled Invoke jobs fail with a republish instruction. A new Robot build is required; sending a portable definition does not upgrade an old Robot.

Limits: 8 MB serialized definition; 101 workflows; 100 call references / 16 levels; 5 MB / 2,000 activities per file; existing typed argument bounds; 10,000 activity/loop visits; 2 MB combined frame outputs; 2,000 buffered events / 2 million raw log characters with 4,000-character previews. Bounds fail explicitly or cap logs.

Coverage: source preservation and reachable files/targets; reproducible versioned IDs; source-free execution; corruption/cycles/paths/missing refs; target conflicts/tombstones; unsupported activities; typed isolation and transactional failures; control blocks; legacy behavior; publish transport and version checks; secret aliases; real browser extraction; production listener/queue/callbacks; full UI prepare/download/publish, stale refresh, read errors and dark/light/compact layouts.
