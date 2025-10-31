# forge v1 - Actionable Implementation Plan

## Key Principles
- Git is the source of truth for repositories and merge requests; v1 stores no duplicate state in SQLite.
- Every request derives merge request data straight from refs and commits (`git for-each-ref`, `git merge-tree`, `git diff`).
- CI status is recorded in filesystem artifacts (`logs/<repo>/<commit>.*`) so restarts never desync logical state.
- The forge daemon runs everything (HTTP + web UI + CI executor) under a single `forge` user; no worker fleet.
- Bun/TypeScript remain the stack, Datastar drives the minimal interactive UI, and server-side rendering keeps pages fast.
- Deploy exclusively through the existing NixOS/`just hetzner` pipeline with data rooted at `/var/lib/forge`.

---

## Architecture
```
/var/lib/forge/
├── repos/               # Bare git repositories exposed over SSH
│   ├── project-a.git/
│   └── project-b.git/
├── work/                # Operational clones used for CI and merges
│   ├── project-a/
│   └── project-b/
└── logs/                # CI output and status files
    └── project-a/
        └── <commit>.{log,status}
```

**Merge Requests from Git**
- Enumerate repos by scanning `/var/lib/forge/repos/*.git`.
- Feature branches are `refs/heads/*` excluding the default branch (`master` for v1). No record means no MR.
- For each branch we derive at request time:
  - tip commit (`git rev-parse <branch>`)
  - merge base with `master` (`git merge-base`)
  - ahead/behind counts (`git rev-list --left-right --count`)
  - conflict check (`git merge-tree --write-tree master branch`)
  - diff (`git diff --no-color base..branch`)
- Branch deletion automatically removes the MR because the ref disappears.

**CI Execution**
- The post-receive hook notifies the forge server for branch updates.
- The server kicks off CI immediately (sequential for v1) inside the appropriate worktree clone.
- Each run streams stdout/err to `logs/<repo>/<commit>.log` and writes a tiny JSON status file on completion (`passed/failed`, exit code, timestamps).
- Page renders read the latest status file for the branch tip; if none exists, show "Not run" or "Running" while the process is active.

**Processes**
- `forge.service`: Bun HTTP server exposing HTML, JSON endpoints, and running CI jobs.
- No background queue or timers—only hook-driven updates and on-demand reads.

---

## Implementation Plan

### Phase 1: Project Bootstrap (Day 1)
1. Initialize the project structure:
   ```bash
   cd ~/code
   mkdir -p forge && cd forge
   bun init -y
   mkdir -p src/{git,http,ci,views,utils}
   touch src/index.ts src/server.ts
   ```
2. Create `flake.nix` wiring in Bun and the runtime entrypoint:
   ```nix
   {
     description = "Forge - Minimal Git Server";

     inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

     outputs = { self, nixpkgs }: {
       packages.x86_64-linux.default =
         nixpkgs.legacyPackages.x86_64-linux.stdenv.mkDerivation {
           name = "forge";
           src = ./.;
           buildInputs = [ nixpkgs.legacyPackages.x86_64-linux.bun ];

           buildPhase = ''
             export HOME=$TMPDIR
             bun install --frozen-lockfile || bun install
           '';

          installPhase = ''
            mkdir -p $out/bin $out/app
            cp -r src package.json bun.lockb $out/app/ 2>/dev/null || true
            if [ -f tsconfig.json ]; then cp tsconfig.json $out/app/; fi
            cat > $out/bin/forge <<EOF
            #!/usr/bin/env bash
            exec ${nixpkgs.legacyPackages.x86_64-linux.bun}/bin/bun $out/app/src/index.ts
            EOF
            chmod +x $out/bin/forge
          '';
         };
     };
   }
   ```
3. Add runtime dependencies (Datastar for UI hydration, optional helper libs):
   ```bash
   bun add @sudodevnull/datastar
   bun add -d @types/bun
   ```

### Phase 2: Git & Filesystem Primitives (Day 1-2)
1. Implement repo discovery (`src/git/repos.ts`):
   ```typescript
   export async function listBareRepos(dataDir: string) {
     const reposPath = join(dataDir, 'repos');
     const entries = await readdir(reposPath, { withFileTypes: true });
     return entries
       .filter(e => e.isDirectory() && e.name.endsWith('.git'))
       .map(e => ({ name: e.name.replace(/\.git$/, ''), path: join(reposPath, e.name) }));
   }
   ```
2. Implement branch introspection (`src/git/branches.ts`):
   - `listBranches(repoPath)` using `git for-each-ref --format='%(refname:short)' refs/heads`.
   - Filter out the mainline branch (`master`).
3. Implement merge request descriptor (`src/git/merge-request.ts`):
   ```typescript
   export async function describeMergeRequest(repoPath: string, branch: string) {
     const base = await runGit(repoPath, ['merge-base', 'master', branch]);
     const head = await runGit(repoPath, ['rev-parse', branch]);
     const conflicts = await mergeConflicts(repoPath, branch);
     const diff = await runGit(repoPath, ['diff', '--no-color', `${base}..${branch}`]);
     const aheadBehind = await runGit(repoPath, ['rev-list', '--left-right', '--count', `${branch}...master`]);
     return { branch, head, base, conflicts, diff, aheadBehind: parseAheadBehind(aheadBehind) };
   }
   ```
4. Build a thin `runGit` helper that wraps Bun’s `spawn` with consistent error handling.

### Phase 3: HTTP Server & Routing (Day 2-3)
1. `src/server.ts` creates the Bun server, wiring `fetch` to route handlers.
2. Routes:
   - `/` → list repos (calls `listBareRepos`).
   - `/r/:repo` → list merge requests (scan branches, map through `describeMergeRequest`).
   - `/r/:repo/mr/:branch` → detailed view (re-run descriptors, load CI status/log excerpt).
   - `/hooks/post-receive` → accepts JSON from hook and triggers CI.
3. Ensure handlers gracefully handle long-running Git commands (timeouts, error responses).

### Phase 4: CI Runner (Day 3)
1. Implement `updateWorktree(workDir, repoPath, branch)` that clones on first run and fetches branch updates afterwards.
2. `runCI({ repo, branch, commit })` should:
   - create `logs/<repo>` if missing;
   - stream `nix run .#ci` output into `<commit>.log`;
   - write `<commit>.status` JSON `{ status, exitCode, startedAt, finishedAt }` when done;
   - expose in-memory state for "running" to cover the window before the status file lands.
3. Serialize CI executions per repo (simple mutex) so v1 never runs two jobs simultaneously.

### Phase 5: Views with Datastar (Day 3-4)
1. Render HTML templates (`src/views`) that:
   - show repo → branch list with conflict + CI badges;
   - display diff/CI log in the MR detail view;
   - expose a merge button wired to `POST /r/:repo/mr/:branch/merge` once CI passed and conflicts clean.
2. Use Datastar for lightweight interactivity (polling CI status, triggering merges without full reload).

### Phase 6: Merge & Update Paths (Day 4)
1. Implement server-side merge handler using `git merge-tree` + `commit-tree` + `update-ref`.
2. After a successful merge, delete the feature branch (`git update-ref -d refs/heads/<branch>`).
3. Because state comes from refs, the branch disappearing immediately removes it from the MR list.

### Phase 7: NixOS Integration (Day 4)
1. Create `~/configs/hetzner/forge.nix` to define the `forge` service, system user, directories, and environment variables (no database).
2. Wire the package into `~/configs/flake.nix` and the Hetzner host configuration.
3. Configure Caddy to reverse proxy the Bun server.

### Phase 8: Deploy & Smoke Test (Day 4)
1. Deploy via `just hetzner`.
2. Initialize a bare repo under `/var/lib/forge/repos/`. The forge service installs the hook on startup if missing.
3. Push a feature branch, confirm the MR appears, CI runs, and the merge button updates state correctly.

---

## Summary
- Forge v1 keeps persistence minimal: Git refs and filesystem logs drive all behavior.
- No cleanup jobs or cache invalidation paths exist because nothing is cached.
- CI remains serialized and synchronous; future work can introduce a queue (likely SQLite) if parallelism or history retention becomes necessary.

---

## Post-receive Hook Template
```bash
#!/usr/bin/env bash
set -euo pipefail
zero=0000000000000000000000000000000000000000

while read -r oldrev newrev refname; do
  # ignore deletions and non-branch refs
  if [ "$newrev" = "$zero" ]; then
    curl -sS -X POST http://localhost:3030/hooks/post-receive \
      -H 'Content-Type: application/json' \
      -d "{\"repo\":\"$PWD\",\"ref\":\"$refname\",\"deleted\":true}" || true
    continue
  fi

  case "$refname" in
    refs/heads/master)
      ;; # nothing to do for mainline updates
    refs/heads/*)
      curl -sS -X POST http://localhost:3030/hooks/post-receive \
        -H 'Content-Type: application/json' \
        -d "{\"repo\":\"$PWD\",\"ref\":\"$refname\",\"oldrev\":\"$oldrev\",\"newrev\":\"$newrev\"}" || true
      ;;
  esac
done
```
