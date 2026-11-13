# Shared UI targets

Run `node tests/ui-targets/launch.cjs` on Windows with dependencies and Chrome installed.
Fixtures, saved workflow copies and screenshots go to a new temporary directory.
The suite does not open or rewrite existing user workflows or contact Runway.

The tests cover persistence and validation, two previously saved workflows using a
single updated selector, import precedence, portable snapshots, missing-target
preflight, execution snapshots, unlinking, deletion protection, storage failure,
and real Get Text against a local browser fixture. Browser UI checks exercise
create/link/update, known usages, publishing, both themes, and the compact layout.

In Studio, open **Targets** in the toolbar or **UI Targets** in the bottom panel.
Create a named Browser or Desktop target, grouped by application. In an activity's
selector field, select a shared target or choose **Save as shared target** to create
and link one from its current selector. Linked fields display the current selector
and offer **Edit in library** and **Unlink**.

The library is stored on this device, separately from workflow files. Workflows
retain IDs and include a snapshot of their referenced targets for portability.
When a workflow is opened, unknown IDs are imported; existing library entries are
authoritative and are never overwritten by an older embedded snapshot. An update
applies on the next run of every locally linked workflow, including closed files.
No workflow files are rewritten in the background. Updating a linked selector
refreshes the open canvas and marks its snapshot as needing an explicit Save.

Runs resolve the entire library once before any activity starts; a missing target
blocks execution rather than falling back to a stale selector. Edits during a run
take effect on the next run. Unlink retains the latest selector as a local value.
Only unused targets can be deleted; known references are indexed when workflows
are opened or saved. Files never opened in this Studio instance are not indexed.
Deleted IDs are remembered so old file snapshots cannot silently restore them.
Library updates also synchronize between Studio windows sharing the same storage.

Publishing bundles the current referenced targets and resolved selectors. Robot
uses this versioned bundle independently of the Studio installation. Changes to
the local library require republishing to update already published Robot versions.
