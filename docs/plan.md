# forge v1 – Development Plan
This plan implements the requirements in `docs/spec.md`; review that specification for complete context before starting work.

1. **Project Bootstrap**
   - Initialize Bun/TypeScript workspace, align directory layout with spec (`src/git`, `src/http`, `src/ci`, `src/views`, `src/cli`, `src/utils`).
   - Add foundational configs (`tsconfig.json`, `.editorconfig`, lint rules) and shared types.
   - _Verify_: `bun run check` (or `bun test` placeholder) succeeds; `forge --help` prints usage stub.

2. **Nix Packaging & Service Entrypoint**
   - Create `flake.nix` that builds the Bun app and exposes a runnable `forge` binary.
   - Add basic environment handling (data dir, port, merge password) and minimal `src/index.ts` to launch the server.
   - _Verify_: `nix run .#forge -- --version` (or `--help`) works inside `nix develop`, launching a no-op server that binds and exits cleanly.

3. **Filesystem & Git Helpers**
   - Implement utilities to enumerate bare repos, list branches, and derive MR metadata (head/base commits, ahead/behind, diff, conflict check).
   - Wrap Git invocations in a reusable helper that captures stdout/stderr and normalizes errors.
   - _Verify_: run a targeted Bun test that seeds a temp repo and asserts helper outputs (e.g., `bun test tests/git-helpers.test.ts`).

4. **SQLite Bootstrap**
   - Introduce `forge.db` migrations for `merge_history` and `ci_jobs` tables plus a migrations ledger.
   - Provide a singleton DB module with prepared statements for inserts/queries used across the app.
   - _Verify_: run a Bun test that initializes an in-memory DB, executes migrations, and asserts tables/columns exist.

5. **Integration Test Harness Foundation**
   - Stand up the Bun-based integration framework that spins up temp repos, launches the server on an ephemeral port, and exercises simple HTTP/CLI flows against placeholder handlers.
   - Wire the harness into `bun test` so subsequent steps can add coverage incrementally.
   - _Verify_: run the smoke suite (`bun test tests/integration-smoke.test.ts`) to confirm the harness can start/stop the server and clean temporary repos.

6. **HTTP Server Skeleton**
   - Build the Bun HTTP server with routing for `/`, `/r/:repo`, `/r/:repo/mr/:branch`, `/r/:repo/history`, `/jobs`, and `/hooks/post-receive`.
   - Ensure JSON error responses and basic logging are in place.
   - _Verify_: enhanced smoke test hits each route, expecting placeholder HTML/JSON; curl checks continue to pass.

7. **Merge Request Views**
   - Render SSR HTML for repo list, MR list, and MR detail, including diff snippets, ahead/behind display, CI status banner, and merge button placeholder.
   - Embed the auto-merge trailer state and merge gating UI (disabled button or CI-required alert).
   - _Verify_: add view-specific tests/snapshots (e.g., `bun test tests/views.test.ts`) and confirm integration smoke test renders the pages.

8. **Merge Execution Path**
   - Implement password-protected merge POST handler: re-validate branch state, run `merge-tree`/`commit-tree`, update refs, delete branch, append history row.
   - Add browser password prompt script and server-side verification using env-based secret.
   - _Verify_: integration test pushes a feature branch, posts to the merge endpoint with the correct password, confirms branch deletion and history entry.

9. **Post-receive Hook & Auto-merge Queue**
   - Implement hook endpoint to record branch updates (including deletions), kick off CI, and detect `Forge-Auto-Merge` trailers on branch heads.
   - After CI success, auto-trigger merges when the trailer is present, reusing the merge path and logging history.
   - _Verify_: integration test sends post-receive payload simulating a push with the trailer, observes CI job creation, and confirms auto-merge after a simulated CI pass.

10. **CI Runner & Status Files**
    - Create job model that launches `nix run .#ci` in per-job worktrees, writes log/status files, updates `ci_jobs`, and tears down worktrees.
    - Implement job cancellation handling and CPU snapshot sampling when requested.
    - _Verify_: integration test triggers a deterministic CI job, inspects log/status artifacts, and covers manual cancel path.

11. **Jobs Dashboard & CLI Tools**
    - Build `/jobs` SSR view showing active jobs (CPU usage, cancel buttons) followed by the latest 100 historical jobs.
    - Implement CLI subcommands (`status`, `wait-ci`, `cancel-ci`, `jobs`) sharing core logic with the HTTP layer.
    - _Verify_: integration test hits `/jobs`, confirms running job appears with CPU snapshot & cancel link; CLI smoke test exercises each subcommand.

12. **History & Logs Presentation**
    - Populate `/r/:repo/history` using SQLite records plus Git trailers, linking to stored logs and handling missing artifacts gracefully.
    - Ensure MR detail pages surface CI logs and manual cancel actions.
    - _Verify_: integration test merges a branch, checks history page entries, and confirms missing log messaging works.

13. **Playwright UI Smoke Tests**
    - Add Playwright scripts (running inside Nix) to verify critical UI paths: repo list, MR detail gating, jobs dashboard, merge prompt, and auto-merge flow.
    - _Verify_: `nix develop -c playwright test` passes locally with seeded fixtures.

14. **NixOS Module & Deployment Glue**
    - Define `hetzner/forge.nix`, hook installation logic, service configuration, and Caddy reverse proxy settings; document deploy procedure (`just hetzner`).
    - _Verify_: `nix build .#forge` produces the package, and NixOS evaluation succeeds with the new module.
