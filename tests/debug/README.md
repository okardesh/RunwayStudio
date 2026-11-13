# Locals & Watch regression checks

Run from the repository root with dependencies installed:

```powershell
node tests/debug/launch.cjs
```

The suite requires Google Chrome at its standard Windows installation path. It bundles the production executor and UI into a fresh temporary directory, uses isolated storage, and never opens or rewrites workspace workflow files. The browser fixture exercises the real Get Text implementation against a temporary HTML page. The UI fixture mocks the Electron activity bridge and does not contact Runway.

Coverage includes breakpoint snapshots, Step Into/Step Over, adding watches while paused, collection mutations, loop scope restoration, Stop, errors, stale session clearing, credential masking, bounded previews, persistence failures, and dark/light and compact layouts.

## Using the panel

Select Debug, set a breakpoint, and start Debug workflow. Locals & Watch opens automatically. Locals shows the current runtime type, value, scope, and last activity that changed each variable. Expand a value to inspect its bounded snapshot; use the plus button to watch a local. Values refresh at activity boundaries and pauses, including Get Text outputs and assignments. The panel cannot inspect intermediate state inside a native activity while it is executing.

Watches support variable names, `{{variable}}`, own object properties, numeric or quoted indexes, `Length`/`Count`, primitive `ToString()`, and string `Trim()`, `ToUpper()`, and `ToLower()`. For example: `textResult`, `textResult.Length`, `items[0].amount`. Unsupported expressions and out-of-scope variables display an error without affecting execution. Watches do not allow assignment, arbitrary function calls, getters, or inherited property access.

Only watch expressions are saved in local preferences. Runtime values stay in memory. Finished, stopped, and failed debug sessions retain a clearly labeled last snapshot; a new debug session replaces it and a normal Run clears it. Newly added watches require an active debug session to evaluate. Known sensitive names and secret strings are masked. Previews are limited; watches evaluate the full runtime value.
