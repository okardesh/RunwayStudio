# Runway Robot

Runway Robot is a Windows Electron tray application that executes published RPA workflow definitions on the local machine.

## Run

From the Studio workspace root:

```powershell
npm.cmd --prefix .\Robot run dev
```

Robot opens a connection window until Runway validates the Robot license and returns an API key. After connection, it hides to the Windows system tray and listens on port `5050` by default. Set `RUNWAY_ROBOT_PORT` to use another port.

During registration and heartbeat, Robot sends its actual Windows hostname as both `hostname` and `deviceName`, plus its reachable `listenerUrl` (for example, `http://192.168.1.24:5050`). Runway should dispatch to this registered listener URL, never to an endpoint in the workflow definition.

## Runway trigger contract

Runway invokes Robot with an authenticated request:

```http
POST http://<robot-host>:5050/api/robot/jobs
Content-Type: application/json
X-API-Key: <Robot API key>
```

```json
{
  "jobId": "runway-job-id",
  "workflowId": "rpa-workflow-id",
  "workflow": {
    "definition": {
      "nodes": [],
      "edges": [],
      "variables": []
    }
  },
  "inputs": {},
  "callbackUrl": "http://<runway-host>/api/v1/robot-jobs/runway-job-id/complete"
}
```

Robot responds immediately with `202` and queues jobs sequentially:

```json
{
  "ok": true,
  "jobId": "runway-job-id",
  "status": "queued"
}
```

## Completion callback

Robot posts the execution result to `callbackUrl` with the same `X-API-Key` and `X-Tenant-Id: default` headers:

```json
{
  "jobId": "runway-job-id",
  "workflowId": "rpa-workflow-id",
  "status": "success",
  "logs": [
    {
      "timestamp": "2026-08-15T00:00:00.000Z",
      "level": "info",
      "message": "Job completed."
    }
  ],
  "completedAt": "2026-08-15T00:00:00.000Z"
}
```

Failed jobs use `"status": "failed"` and include an `error` field plus the collected job log.

## Windows installer

Build the unified Windows installer from the Studio workspace root:

```powershell
npm run package:win
```

The build produces `release/Runway Setup x64 0.1.0.exe` and `release/Runway Setup arm64 0.1.0.exe`. Each installer has a component selection page for Studio, Robot, or both applications. Windows 32-bit is not supported because the automation Canvas dependency does not provide a 32-bit native binding.
