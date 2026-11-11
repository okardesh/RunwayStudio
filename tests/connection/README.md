# Runway connection regression tests

From the Studio checkout on Windows:

```
node tests/connection/launch.cjs
```

Twenty Node integration scenarios test real localhost HTTP requests, URL validation,
license registration/heartbeat/release payloads, malformed or denied responses,
header/body timeouts, retries, cached keys and single-flight registration. Fake API
keys and in-memory credential storage are used; no real licenses are consumed.

Six Electron scenarios exercise the production preload and scoped main-process IPC
with the real ConnectionAssistant component: a cross-origin browser CORS failure,
successful file-origin desktop connection, heartbeat/release, rejection of an
untrusted window, the real ten-second timeout with form recovery, and retry.
Browser security remains enabled. The test API intentionally omits CORS headers;
this verifies transport independence and does not diagnose a real server's CORS policy.

The launcher prints the results directory and exits nonzero on failures. The tests
are independent of the user's Runway Server and stored production API keys.
