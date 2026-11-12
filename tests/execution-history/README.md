# Execution history

Run `node tests/execution-history/launch.cjs` on Windows with dependencies and Chrome installed.
The suite exercises the workflow executor, persistent history, retry/catch behavior,
stop while debugging, credential masking, storage limits, and the React history panel.
It also checks the production screenshot function in a separate Electron process.
Fixtures, browser screenshots and compiled test bundles go to a temporary directory.
The suite does not connect to Runway or modify user workflows.

In Studio, select **Run History** in the bottom panel. Failed runs open it automatically.
Select an activity to inspect its duration, inputs, runtime variables and failure details;
**Show on canvas** selects the activity and expands its parent. Failed activities receive
a red outline. Repeated attempts appear as separate entries.

History is local to this Studio installation/browser origin. Up to 20 runs and 300 activity
executions per run are retained, with snapshots capped in depth and size. Persistence has
a 1.5 million character budget; older runs, screenshots or trailing steps can be omitted
to fit it. Active runs are checkpointed at most once per second when events arrive and
show as interrupted after a reload. **Clear history** keeps an ongoing run.

**Capture desktop on error** controls capture of the first display (up to three JPEGs per
run). Images can contain visible application data. Known credential fields and their
values are masked in text snapshots; images are not redacted. Capture failures or
unavailable storage do not prevent workflow execution.
