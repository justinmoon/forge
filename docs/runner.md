# Forge Runner Spec (Lightweight External CI)

## Goals
- Run CI concurrently on multiple machines (e.g., Hetzner Linux + local Mac).
- Keep the runner tiny: pull jobs, run `just pre-merge` (or `nix run .#pre-merge`), stream logs, report status.
- Avoid inbound connectivity requirements on runners (poll-based, NAT-friendly).
- Allow optional platforms (Mac) to be informative without blocking merges.
- Make runners portable so moving to a dedicated Mac host is just reconfiguring a token.

## Non-goals
- Full GitHub-style checks UI; reuse existing jobs/logs UI.
- Complex scheduling or auto-scaling.
- Secrets management beyond a shared runner token (v1).

## Terminology
- **Runner**: a lightweight agent that claims CI jobs and executes them.
- **Job**: a pre-merge or post-merge CI run for a commit.
- **Platform**: runner label such as `x86_64-linux` or `aarch64-darwin`.

## Job Model Changes
Add fields to `ci_jobs`:
- `platform TEXT` (required: `x86_64-linux`, `aarch64-darwin`, etc)
- `required INTEGER` (1 = gate merge, 0 = optional)
- `runner_id TEXT` (runner name or UUID)
- `claimed_at DATETIME`
- `heartbeat_at DATETIME`
- `attempt INTEGER DEFAULT 1`

Status values stay consistent: `pending`, `running`, `passed`, `failed`, `timeout`, `canceled`, `stale`.

## Scheduling & Gating
- For each push, enqueue one job per required platform plus any optional platforms.
- Merge gating requires **all required jobs** for the head commit to pass.
- Optional jobs surface in the UI but never block merges.
- If a required job becomes `stale` (no heartbeat), it may be retried or fail the merge (configurable).

## Runner API (HTTP)
All endpoints use `X-Forge-Runner-Token`.

### Claim a job
`POST /api/runner/claim`
Request body:
```json
{
  "runnerId": "macbook-pro",
  "labels": ["aarch64-darwin"],
  "maxJobs": 1
}
```
Response: `204` if no job; else job payload:
```json
{
  "jobId": 123,
  "repo": "monorepo",
  "branch": "feature-x",
  "headCommit": "abc123",
  "platform": "aarch64-darwin",
  "required": false,
  "run": "pre-merge"
}
```

### Stream logs
`POST /api/runner/log`
```json
{ "jobId": 123, "chunk": "stdout/stderr text..." }
```

### Heartbeat
`POST /api/runner/heartbeat`
```json
{ "jobId": 123 }
```

### Finish
`POST /api/runner/finish`
```json
{
  "jobId": 123,
  "status": "passed",
  "exitCode": 0,
  "finishedAt": "2025-01-01T00:00:00Z"
}
```

### Cancel (server -> runner)
Runners poll job status; if canceled, they should terminate the process and report `canceled`.

## Runner Behavior
1. Poll `/api/runner/claim` every `N` seconds.
2. When claimed, fetch repo using a configured remote:
   - `FORGE_GIT_REMOTE` (e.g., `forge@forge.host:{repo}.git`).
3. Checkout `headCommit` in a temporary workdir.
4. Run `just pre-merge` (or `nix run .#pre-merge`); for post-merge use `just post-merge` or `nix run .#post-merge`.
5. Stream logs; send heartbeat every `M` seconds.
6. On exit, send `finish` with status + exit code.
7. Clean up workdir.

Environment passed to the command:
- `FORGE_REPO`, `FORGE_BRANCH`, `FORGE_COMMIT`, `FORGE_JOB_ID`.

## Logging
- Logs are written server-side to `logs/<repo>/<commit>.log` (platform suffix optional).
- Status JSON written to `logs/<repo>/<commit>.status` includes platform, jobId, timestamps.
- Jobs UI shows per-platform status and links to logs.

## Security
- Runner auth uses a shared token (per runner or per fleet).
- Tokens can be revoked by deleting from config.
- No inbound connectivity required from runners.

## Deployment
### Hetzner (Linux)
- systemd service `forge-runner@linux.service` with `FORGE_LABELS=x86_64-linux`.

### Mac
- launchd plist running `forge-runner` with `FORGE_LABELS=aarch64-darwin`.

## Backward Compatibility
- Forge server can still run CI in-process if no external runners are configured.
- When external runners are enabled, in-process CI is disabled or treated as a runner with label `x86_64-linux`.

## Open Questions
- Should job logs include platform suffix in filenames?
- Stale job policy: auto-retry vs fail-fast for required jobs.
- How to handle multiple Mac runners (choose oldest pending or random)?
