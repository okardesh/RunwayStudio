# Central assets, credentials and environments

Studio's **Assets** panel manages Maestro environment profiles and typed central values. Select an environment for local Run/Debug, or choose an environment independently in **Robot Jobs**. Each run records its environment in Run History. Disabled or missing environments never fall back to another profile.

Supported types are `String`, `Boolean`, `Int32`, `Double`, JSON `Object`, `Secret` and `Credential`. Non-string values use JSON in the editor. **Get Asset** selects a static name and expected type, then writes its value to an output variable. **Get Credential** writes username/password to distinct output variables. Both work in called workflows, local Debug and portable Robot packages.

Portable packages contain references, not fetched values. Maestro checks all package references against the selected environment before dispatch. The Robot receives a random per-job capability restricted to those references and that environment; the database stores only its hash. It cannot read other assets with that capability. A terminal job or expired grant cannot resolve more values. Values are cached on first use within a run; a new run reads the latest central value, so updating an asset does not require republishing.

Credential and Secret values are encrypted using Fernet in Maestro's existing SQLite database. The generated `studio-assets.key` sits next to the workflow database and is created with owner-only permissions on macOS/Linux. Back up this key with the encrypted database; a missing/corrupt key fails closed and is never silently replaced when protected records already exist. Use the host's normal TLS/access controls for production transport and protect the data directory on every supported host.

Protected values are write-only in management views and catalogs. Editing a saved credential starts with blank fields; enter both fields to replace it. Saving or switching environments clears protected drafts. No credential or API key is saved in Studio's environment preference, package or history. Known credential values, aliases and supported expression-derived values are masked in logs, Locals/Watch and history; error screenshots are omitted after protected values have been used. Runtime activities receive the actual values in memory so they can authenticate to target applications.

Asset updates/deletes require the current revision to prevent overwriting another operator's change. Audit rows record the action, asset name, environment and timestamp without values. The API follows Maestro's existing global administrative API key and tenant policy; this feature does not introduce a new per-user authorization system. Robot read access additionally requires its registered key and the per-job capability.

## Maestro installation

The installer adds the existing dispatch hooks, the `maestro_assets.py` backend and an **Assets & Credentials** tab in Maestro's RPA page. The Maestro management tab asks for an administrative API key for the current page session and does not persist it. Studio uses its existing encrypted connection bridge.

```powershell
node server/install-maestro-robot-jobs.cjs C:/path/to/Maestro
# After reviewing updates to already installed adapter/UI files:
node server/install-maestro-robot-jobs.cjs C:/path/to/Maestro --update
```

Rebuild/restart Maestro's API and UI to activate the changes; packaged desktop builds must include the new backend imports and updated frontend. The installer adds `X-API-Key` to Maestro's existing CORS header list for its separate UI/API ports. It does not modify workflow files, databases or encryption keys. During this implementation the adapter and RPA UI were also installed into the active Mac Runway development build, with its previous API/UI bundles retained as rollback copies.

| Route | Purpose |
| --- | --- |
| `GET /api/v1/studio-assets` | Environment profiles and metadata; protected values are omitted |
| `POST /api/v1/studio-assets/profiles` | Create/rename/enable/disable an environment |
| `POST /api/v1/studio-assets/values` | Revision-checked create/update/delete |
| `POST /api/v1/studio-assets/resolve` | Resolve a value for an authorized Studio run |
| `POST /api/v1/robot-jobs/:id/assets/resolve` | Resolve an allowlisted reference using the job capability |

Job submissions add `environmentId`; older callers default to `default`. Job results retain the chosen profile ID/name. Analyzer checks reference syntax, outputs, profile availability and asset types from metadata without reading protected values.

## Verification

```powershell
node tests/assets/launch.cjs
node tests/robot-jobs/launch.cjs --maestro-source=C:/path/to/Maestro/script_server.py --assets
npm.cmd run build
npm.cmd --prefix Robot run build
```

The suites use fresh OS temporary directories, SQLite databases, browser profiles and Robot fixtures. They cover encrypted storage, key loss/restore, tenant-filtered lookup, disabled/missing profiles, revision conflicts, capability/allowlist/terminal-job denial, local Debug/Watch masking, portable references, real HTTP Robot-to-Maestro resolution, typed outputs, central updates without republishing, and Studio Dark/Light/compact layouts. Original untracked workspace files are excluded from fixtures and remain untouched.
