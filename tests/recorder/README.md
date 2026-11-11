# Recorder regression tests

Run `npm run test:recorder` from a Windows desktop terminal after `npm install`.
The suite builds the real React components and runs them in Electron's real
webview, with an isolated temporary profile and local fixture server. It does
not connect to Runway Server, activate licenses, or edit existing workflows.

Coverage includes exact selector matching (test IDs, quoted attributes, duplicate
and special IDs, deep DOM paths, SVG), pick/repick/stop/Escape, page navigation
and failure recovery, repeated cleanup, StrictMode, desktop rerenders, unmount
cancellation, a missing native window, and native process abortion.

For an interactive Windows UIA smoke test, run `npm run test:recorder -- --native`.
When the Recorder Fixture window appears, click its **Kaydet İstanbul**
button once. After the picker starts again, press Escape. This verifies a real
Windows capture, UTF-8 output, and native keyboard cancellation. Target clicks
are passed through to the application, so the fixture's button has no side effects.
The native fixture is compiled with the installed .NET Framework C# compiler.

The runner prints the path to its JSON results and returns a nonzero exit code
for failures. Desktop React tests use a controlled IPC substitute; native smoke
tests separately exercise the actual PowerShell/UIA picker. These tests do not
cover server licensing, workflow persistence, or playback against customer apps.

## Workflow recording

Use **Design → Record** to record an entire browser workflow. Click Start Recording,
then Go; browse, type and press Enter normally. Choose an output variable name,
click **Get Text → Variable**, and click the result text. Finish & Save Recording
adds executable browser activities, String variables and (when checked) Log Message
activities, then saves through Studio's normal workflow save flow. Cancelling the
file dialog keeps the recording available without inserting duplicate activities.
The selector picker in activity properties remains a separate single-element tool.

Run `npm run test:recorder:session` from a Windows desktop terminal. These tests
exercise recording across navigation, input flushing, stable named-input selectors,
background iframe loading, text extraction, unmount after saving, JSON round-trip,
and actual Chrome playback using the Studio browser engine and workflow executor.
The fixture's currency text is fixed test data; it is not a live exchange rate.
Google's live result and verification challenges are covered separately by the
interactive test; a CAPTCHA requires the user's intervention.
