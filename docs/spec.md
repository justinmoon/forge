# Forge v1 Specification

## Scope & Goals
- Deliver a single-tenant forge that mirrors Justin's existing Git workflows without introducing new configuration surfaces.
- Present merge requests, CI status, and merge operations by reading authoritative state directly from Git repositories, filesystem artifacts, and a minimal SQLite history ledger.
- Keep the code path intentionally simple by avoiding speculative caches and complex background workers in v1.
- Render HTML server-side and rely on minimal progressive enhancement only where absolutely necessary.

## Non-goals
- Multi-user auth, permissions, or external identity providers.
- Mirroring third-party APIs (GitHub/GitLab); all state originates from the local bare repositories.
- Advanced notifications, webhooks, or LLM log analysis (tracked in Backlog).

## Runtime Environment
- System user `forge` owns `/var/lib/forge`.
- Bun/TypeScript server (`forge.service`) handles HTTP, merge orchestration, and CI execution.
- Deployment managed through the existing NixOS + `just hetzner` pipeline.
- Default branch hard-coded to `master` for every repository.

## Authoritative Data Sources
- **Git**: repositories under `/var/lib/forge/repos/*.git`.
- **CI artifacts**: files written under `/var/lib/forge/logs/<repo>/`.
- **SQLite**: `/var/lib/forge/forge.db` persists immutable events (merge history, CI job metadata) and coordination state for the job runner.

## Repository Discovery
- Whenever the server needs a repo list it enumerates directories in `/var/lib/forge/repos` (no caching).
- Bare repo name is derived from the directory name with the `.git` suffix removed.
- There is no repo metadata store; all derived information is computed on demand.

## Merge Requests
### Listing
- Feature branches are every `refs/heads/*` except `refs/heads/master`.
- Branch enumeration happens when rendering repo pages or accepting hook events.
- Branch deletion automatically removes the merge request because the ref disappears.

### Derived Fields (computed per request)
- Head commit: `git rev-parse <branch>`.
- Merge base: `git merge-base master <branch>`.
- Ahead/behind counts: `git rev-list --left-right --count <branch>...master`.
- Conflict check: `git merge-tree --write-tree master <branch>` (success ⇒ clean).
- Diff preview: `git diff --no-color <base>..<branch>`.
- CI summary: read from `logs/<repo>/<head>.status` when present; otherwise show `Not configured`, `Running`, or `Unknown`. When `Not configured`, the UI surfaces instructions for enabling CI.

### Merge Request Detail View
- Displays derived fields plus the streamed CI log (`logs/<repo>/<head>.log`) when available.
- If CI status is `Not configured`, the merge control is replaced with an alert explaining CI is required (for Justin: add `.github/workflows/*.yml` or expose `.#ci` in `flake.nix`) and the merge action is unavailable.
- Merge button remains disabled unless CI status is `passed` and conflicts are `clean`.
- When the merge button is triggered and authorized:
  1. Re-run conflict check to guard against races.
  2. Create merged tree via `git merge-tree --write-tree`.
  3. Create merge commit with canonical message: `Forge Merge: <branch>` and trailers `Forge-Branch: <branch>` and `Forge-Head: <commit>`.
  4. Update `master` (`git update-ref`).
  5. Delete the feature branch (`git update-ref -d refs/heads/<branch>`).

### Auto-merge
- Auto-merge is triggered when the branch head commit includes the trailer `Forge-Auto-Merge: true`. Trailers are `Key: value` lines appended after the commit message body (`git interpret-trailers` can add them).
- When the latest commit advertises the trailer, Forge automatically merges once CI passes and conflicts are clean.
- A new commit without the trailer cancels auto-merge (it must be re-added on the updated head). Failed auto-merge attempts (CI red or merge conflicts) leave the trailer untouched so the next push reuses the setting.
- Auto-merge uses the same password authorization as manual merges; the server carries out the merge with the stored secret.

### Abandoning Merge Requests
- To abandon a merge request, delete the corresponding branch in the remote (e.g., `git push origin --delete <branch>`). Because the forge derives state from refs, the MR disappears immediately.

### Merge History
- History view reuses the MR template with merge controls hidden.
- Source data combines Git metadata (merge commit + trailers) with SQLite records captured when the merge succeeded.
- The `forge.db` schema includes:
  ```sql
  CREATE TABLE merge_history (
    id INTEGER PRIMARY KEY,
    repo TEXT NOT NULL,
    branch TEXT NOT NULL,
    head_commit TEXT NOT NULL,
    merge_commit TEXT NOT NULL,
    merged_at DATETIME NOT NULL,
    ci_status TEXT NOT NULL,
    ci_log_path TEXT,
    UNIQUE(repo, merge_commit)
  );
  ```
- Git trailers (`Forge-Branch`, `Forge-Head`, `Forge-Merge`) are appended to the merge commit message for redundancy; Git tooling exposes them via `git interpret-trailers`.
- For each entry display:
  - Merge commit hash and timestamp.
  - Original branch name and head commit.
  - CI status at merge time and a link to the archived log if available. If the log has been pruned, show a friendly notice.

## Continuous Integration
### Triggering
- The post-receive hook sends JSON to `/hooks/post-receive` for every updated branch, including deletions.
- The server enqueues the latest state immediately; no batching or retries in v1.

### Detection of CI Configuration
- The server checks if the worktree contains a `flake.nix` exposing `.#ci` by running `nix flake show .#ci`.
- If the command exits non-zero due to missing target, CI is considered "Not configured," the UI surfaces guidance, and merge is blocked.
- If the command exists but the run fails, CI status is `failed`.

- Each CI job uses an isolated worktree under `/var/lib/forge/work/<repo>/<job_id>/` created with `git worktree add --force`.
- Jobs start immediately when enqueued; there is no throttling pool so multiple jobs run concurrently until manually canceled.
- Prior to running, the runner fetches refs in the bare repo and checks out the targeted commit. Once the job finishes or is canceled, the worktree is removed to reclaim space.
- CI runs `nix run .#ci` with stdout/stderr streamed to `logs/<repo>/<head>.log`.
- Upon completion, write `logs/<repo>/<head>.status` JSON containing `{ status, exitCode, startedAt, finishedAt, jobId }` and insert/update a row in `ci_jobs`:
  ```sql
  CREATE TABLE ci_jobs (
    id INTEGER PRIMARY KEY,
    repo TEXT NOT NULL,
    branch TEXT NOT NULL,
    head_commit TEXT NOT NULL,
    status TEXT NOT NULL,
    log_path TEXT NOT NULL,
    started_at DATETIME NOT NULL,
    finished_at DATETIME,
    exit_code INTEGER
  );
  ```
- CPU utilization is captured on-demand: when rendering the jobs dashboard or responding to `forge jobs`, Forge samples the current process CPU usage of active jobs and displays it without persisting the value afterward.
- Multiple pushes to the same branch cancel older pending jobs in SQLite before enqueueing the latest commit. Active jobs can be canceled manually via the UI or CLI; cancellation sends a termination signal to the underlying process, marks the job as `canceled`, and tears down its worktree.
- If CI is still running when the MR page renders, display “Running…” with instructions to refresh the page; optional lightweight JavaScript can auto-refresh after a timeout.

## HTTP Interface
- Root (`/`): list all repos.
- Repo overview (`/r/:repo`): list active merge requests derived from branches.
- MR detail (`/r/:repo/mr/:branch`): show MR fields, CI status/log, merge action.
- MR history (`/r/:repo/history`): list merged requests derived from commit trailers.
- Hook endpoint (`/hooks/post-receive`): accepts JSON payload with `{ repo, ref, oldrev, newrev, deleted? }`.
- Merge operations require a shared secret; other reads assume a trusted network.
- Jobs dashboard (`/jobs`): shows running jobs pinned to the top with CPU usage snapshots and cancel buttons, followed by the most recent 100 historical jobs. Repo filters can be added later.

## UI Behavior
- Server-side rendered HTML without front-end frameworks; small vanilla JS snippets are allowed for enhancements (e.g., password prompt, optional auto-refresh).
- CI log viewer streams the full log content inline, with a download link for tooling access.
- All repos and merge requests are visible; there is no filtering or hiding capability.
- When CI is missing, render a static alert detailing how to enable it before merging.
- Jobs view highlights active CI executions with CPU usage readouts and cancel buttons (password-protected via the same prompt mechanism), followed by up to 100 historical entries.

## Merge Authorization
- The server stores a hard-coded password (e.g., via environment variable). The value never appears in rendered HTML.
- Clicking “Merge” triggers a `window.prompt` requesting the password; the response is sent with the POST (header or form field).
- The server validates the password before performing the merge, returning `401 Unauthorized` on failure. No merge state changes occur without authorization.

## Deployment & Operations
- NixOS module defines `forge.service`, required directories, and environment variables.
- Caddy reverse-proxy terminates TLS and forwards requests to Bun on localhost.
- `forge` installs/refreshes the post-receive hook the first time it touches a repo.
- Logs and status files persist indefinitely; manual cleanup handled outside v1 scope.
- `forge.db` lives beside the repos; migrations run automatically on startup using an idempotent schema bootstrap.

## CLI Interface
- Provide a `forge` CLI executable on the server with subcommands:
  - `forge status <repo> <branch>`: prints MR fields, CI status, and merge eligibility.
  - `forge wait-ci <repo> <branch>`: blocks until the latest CI run completes, emitting pass/fail summary.
  - `forge cancel-ci <job_id>`: cancels an active job after password verification.
  - `forge jobs`: lists jobs (running first, then the latest 100 historical entries) with CPU usage snapshots captured when the command runs.
- Coding agents can run commands via `ssh hetzner "forge status foo feature"` to monitor progress without reading web logs.

## Testing Strategy
- Favor high-leverage end-to-end tests over unit tests; only add unit coverage when logic is difficult to exercise via full flows.
- Core integration suite (run via `bun test`):
  - Spins up an ephemeral data directory with actual bare repos using `git init --bare` and seeds commits/branches through real `git` commands.
  - Launches the forge server in-process pointing to the temp data dir, executes HTTP requests against it, and verifies responses (repo list, MR detail, merge outcomes, auto-merge behavior).
  - Triggers CI by simulating post-receive payloads; the test harness provides a lightweight fake `nix` binary on `PATH` that records invocations so we can assert logs/status files without needing full Nix.
  - Exercises CLI commands by invoking the `forge` binary (or entrypoint) directly with the same temp data dir.
  - Tests run sequentially to avoid cross-contamination; fixtures clean up worktrees/logs afterward.
- Playwright UI smoke tests run against a fork of the integration environment:
  - Start forge on a random localhost port using the seeded repos.
  - Validate key flows: landing page repo list, MR detail (including CI log rendering and merge gating), jobs dashboard (active job shows CPU snapshot + cancel), and merge password prompt.
  - Capture screenshots for regression inspection; Playwright runs in headless mode as part of CI.
- Include one test covering auto-merge trailers: push branch with trailer, ensure CI pass auto-merges, and verify history row + branch deletion.
- Another test covers manual cancellation: start a long-running fake CI job, cancel via HTTP/CLI, and confirm job status/log updates correctly.
- Keep fixture helpers in `tests/helpers.ts` to share repo/bootstrap logic; avoid mocks/stubs except for the fake `nix` command.

## Backlog
- Provide notifications/CLI integrations so coding agents can track CI/merge progress similar to `gh`.
- Add LLM-powered CI log summarization to highlight failure causes without sending full logs to agents.
- Support configurable default branches, repo visibility controls, and authentication once single-tenant workflows stabilize.
- Improve MR history persistence if relying on commit trailers proves insufficient (e.g., dedicated refs or structured metadata).
- Reintroduce Datastar or richer client interactivity once foundational features stabilize.
- Auto-merge refinements beyond MVP (multiple signals, scheduling, batching).
