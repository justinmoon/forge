# forge v1 - Actionable Implementation Plan

## Key Decisions

**From the detailed Git plan (keeping):**
- ✅ Use `git merge-tree --write-tree` for conflict detection (no working tree!)
- ✅ Server-side merge: `merge-tree → commit-tree → update-ref`
- ✅ Operational clones separate from bare repos
- ✅ post-receive hook triggers events
- ✅ SQLite schema with repos/MRs/CI jobs

**From NixOS plan (keeping):**
- ✅ Deploy via `just hetzner` only
- ✅ Data in `/var/lib/forge/`
- ✅ NixOS service module pattern
- ✅ Bun/TypeScript (not Rust)
- ✅ Caddy integration

**Simplifications:**
- ❌ No separate `git` user with git-shell (overkill for single-user)
- ❌ No Unix socket (just HTTP on localhost)
- ❌ No per-job systemd units (spawn processes from main service)
- ✅ Single `forge` user owns everything

---

## Architecture

```
/var/lib/forge/
├── repos/              # Bare git repositories
│   ├── yeet.git/
│   └── boom.git/
├── work/              # Operational clones (for CI/merges)
│   ├── yeet/
│   └── boom/
├── logs/              # CI logs
│   └── <job_id>.log
└── forge.db          # SQLite database
```

**Users:**
- `forge`: owns all data, runs web server, executes CI jobs

**Processes:**
- `forge.service`: Bun server (SSR + API + CI job runner)

---

## Implementation Plan

### Phase 1: Project Setup (Day 1)

1. **Create forge repo structure:**
```bash
cd ~/code
mkdir forge && cd forge
bun init -y

mkdir -p src/{db,git,routes,views,ci}
touch src/index.ts
touch src/server.ts
```

2. **Create flake.nix:**
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
          bun install --frozen-lockfile
        '';
        
        installPhase = ''
          mkdir -p $out/bin $out/app
          cp -r src node_modules package.json $out/app/
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

3. **Install dependencies:**
```bash
bun add better-sqlite3
bun add -d @types/bun @types/better-sqlite3
```

### Phase 2: Database & Git Plumbing (Day 1-2)

4. **Create schema (`src/db/schema.ts`):**
```typescript
import Database from 'better-sqlite3';

export function initDB(path: string) {
  const db = new Database(path);
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS repos (
      name TEXT PRIMARY KEY,
      path TEXT NOT NULL
    );
    
    CREATE TABLE IF NOT EXISTS merge_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo TEXT NOT NULL,
      branch TEXT NOT NULL,
      head_commit TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending','running','passed','failed')),
      conflicts TEXT NOT NULL CHECK(conflicts IN ('unknown','clean','conflicted')) DEFAULT 'unknown',
      last_ci_job_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(repo, branch),
      FOREIGN KEY (repo) REFERENCES repos(name)
    );
    
    CREATE TABLE IF NOT EXISTS ci_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mr_id INTEGER NOT NULL,
      commit TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('running','passed','failed','canceled')),
      log_path TEXT,
      started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      finished_at DATETIME,
      exit_code INTEGER,
      FOREIGN KEY (mr_id) REFERENCES merge_requests(id)
    );
  `);
  
  return db;
}
```

5. **Git operations (`src/git/operations.ts`):**
```typescript
import { spawn } from 'bun';

export async function checkConflicts(
  repoPath: string,
  branch: string
): Promise<'clean' | 'conflicted'> {
  const proc = spawn([
    'git', 'merge-tree', '--write-tree',
    'refs/heads/master', branch
  ], { cwd: repoPath, stdout: 'pipe', stderr: 'pipe' });
  
  const exitCode = await proc.exited;
  return exitCode === 0 ? 'clean' : 'conflicted';
}

export async function getDiff(
  repoPath: string,
  branch: string
): Promise<string> {
  // Get merge base
  const baseProc = spawn([
    'git', 'merge-base', 'refs/heads/master', branch
  ], { cwd: repoPath, stdout: 'pipe' });
  const base = (await new Response(baseProc.stdout).text()).trim();
  
  // Get diff from base to branch
  const diffProc = spawn([
    'git', 'diff', '--no-color', base, branch
  ], { cwd: repoPath, stdout: 'pipe' });
  
  return await new Response(diffProc.stdout).text();
}

export async function serverSideMerge(
  repoPath: string,
  branch: string
): Promise<{ success: boolean; error?: string }> {
  // 1. Create merged tree
  const treeProc = spawn([
    'git', 'merge-tree', '--write-tree',
    'refs/heads/master', branch
  ], { cwd: repoPath, stdout: 'pipe', stderr: 'pipe' });
  
  if (await treeProc.exited !== 0) {
    return { success: false, error: 'Merge conflicts' };
  }
  
  const tree = (await new Response(treeProc.stdout).text()).trim();
  
  // 2. Create merge commit
  const msg = `Merge ${branch} into master`;
  const commitProc = spawn([
    'git', 'commit-tree', tree,
    '-p', 'refs/heads/master',
    '-p', branch,
    '-m', msg
  ], { cwd: repoPath, stdout: 'pipe' });
  
  const commit = (await new Response(commitProc.stdout).text()).trim();
  
  // 3. Update master ref
  await spawn([
    'git', 'update-ref', 'refs/heads/master', commit
  ], { cwd: repoPath }).exited;
  
  return { success: true };
}
```

### Phase 3: Web Server & Routes (Day 2-3)

6. **Basic server (`src/server.ts`):**
```typescript
export function createServer(db, config) {
  return {
    port: config.port,
    
    async fetch(req: Request) {
      const url = new URL(req.url);
      
      // Route to handlers
      if (url.pathname === '/') return homeHandler(db);
      if (url.pathname.startsWith('/r/')) return repoHandler(db, url);
      if (url.pathname === '/hooks/post-receive') {
        return await postReceiveHandler(db, req);
      }
      
      return new Response('Not Found', { status: 404 });
    }
  };
}
```

7. **post-receive hook handler:**
```typescript
async function postReceiveHandler(db, req: Request) {
  const { repo, ref, newrev } = await req.json();
  const branch = ref.replace('refs/heads/', '');
  
  if (branch === 'master') return new Response('OK');
  
  // Create/update MR
  const mr = db.prepare(`
    INSERT INTO merge_requests (repo, branch, head_commit, status)
    VALUES (?, ?, ?, 'pending')
    ON CONFLICT(repo, branch) DO UPDATE SET
      head_commit = excluded.head_commit,
      updated_at = CURRENT_TIMESTAMP
  `).run(extractRepoName(repo), branch, newrev);
  
  // Enqueue CI
  await runCI(db, mr.lastInsertRowid);
  
  return new Response('OK');
}
```

### Phase 4: CI Runner (Day 3)

8. **CI execution (`src/ci/runner.ts`):**
```typescript
export async function runCI(db, mrId: number) {
  const mr = db.prepare('SELECT * FROM merge_requests WHERE id = ?').get(mrId);
  const workDir = `/var/lib/forge/work/${mr.repo}`;
  const logPath = `/var/lib/forge/logs/${mrId}.log`;
  
  // Create CI job
  const job = db.prepare(`
    INSERT INTO ci_jobs (mr_id, commit, status, log_path)
    VALUES (?, ?, 'running', ?)
  `).run(mrId, mr.head_commit, logPath);
  
  // Update/clone work directory
  await updateWorkDir(workDir, mr.repo, mr.branch);
  
  // Run nix run .#ci
  const logFile = Bun.file(logPath, { create: true });
  const writer = logFile.writer();
  
  const proc = spawn(['nix', 'run', '.#ci'], {
    cwd: workDir,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  
  // Stream output to log
  proc.stdout.pipeTo(writer);
  proc.stderr.pipeTo(writer);
  
  const exitCode = await proc.exited;
  const status = exitCode === 0 ? 'passed' : 'failed';
  
  // Update job and MR
  db.prepare(`
    UPDATE ci_jobs SET status = ?, exit_code = ?, finished_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(status, exitCode, job.lastInsertRowid);
  
  db.prepare('UPDATE merge_requests SET status = ? WHERE id = ?')
    .run(status, mrId);
}
```

### Phase 5: Views with Datastar (Day 3-4)

9. **MR detail view (`src/views/mr.tsx` or template string):**
```typescript
export function renderMR(mr, diff, ciJob) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>MR: ${mr.branch}</title>
      <script type="module" src="https://cdn.jsdelivr.net/npm/@sudodevnull/datastar"></script>
    </head>
    <body>
      <h1>${mr.repo} / ${mr.branch}</h1>
      <div class="ci-status">
        <h2>CI: ${mr.status}</h2>
        <pre>${ciJob?.log || 'Running...'}</pre>
      </div>
      <div class="diff">
        <h2>Changes</h2>
        <pre>${escapeHtml(diff)}</pre>
      </div>
      <button 
        data-on-click="$$post('/r/${mr.repo}/mr/${mr.branch}/merge')"
        ${mr.status !== 'passed' || mr.conflicts !== 'clean' ? 'disabled' : ''}
      >
        Merge to master
      </button>
    </body>
    </html>
  `;
}
```

### Phase 6: NixOS Integration (Day 4)

10. **Create `~/configs/hetzner/forge.nix`:**
```nix
{ config, lib, pkgs, ... }:

let
  cfg = config.services.forge;
in
{
  options.services.forge = {
    enable = lib.mkEnableOption "Forge Git Server";
    package = lib.mkOption {
      type = lib.types.package;
    };
  };

  config = lib.mkIf cfg.enable {
    users.users.forge = {
      isSystemUser = true;
      group = "forge";
      home = "/var/lib/forge";
      createHome = true;
      openssh.authorizedKeys.keys = [
        "ssh-ed25519 AAAAC3Nza... your-key-here"
      ];
    };
    
    users.groups.forge = {};

    systemd.tmpfiles.rules = [
      "d /var/lib/forge/repos 0755 forge forge -"
      "d /var/lib/forge/work 0755 forge forge -"
      "d /var/lib/forge/logs 0755 forge forge -"
    ];

    systemd.services.forge = {
      description = "Forge Git Server";
      after = [ "network.target" ];
      wantedBy = [ "multi-user.target" ];
      
      serviceConfig = {
        Type = "simple";
        User = "forge";
        WorkingDirectory = "/var/lib/forge";
        ExecStart = "${cfg.package}/bin/forge";
        Restart = "always";
        Environment = [
          "FORGE_DATA_DIR=/var/lib/forge"
          "PORT=3030"
        ];
      };
    };
  };
}
```

11. **Add to `~/configs/flake.nix`:**
```nix
inputs.forge = {
  url = "path:/Users/justin/code/forge";
  inputs.nixpkgs.follows = "nixpkgs";
};

# In nixosConfigurations.hetzner:
{
  services.forge = {
    enable = true;
    package = inputs.forge.packages.x86_64-linux.default;
  };
}
```

12. **Add to `~/configs/hetzner/caddy.nix`:**
```nix
"forge.justinmoon.com" = {
  extraConfig = ''
    reverse_proxy localhost:3030
  '';
};
```

### Phase 7: Deploy & Test (Day 4)

13. **Deploy:**
```bash
cd ~/configs
git add flake.nix hetzner/forge.nix hetzner/caddy.nix
git commit -m "Add forge service"
just hetzner
```

14. **Create first repo:**
```bash
ssh forge@135.181.179.143
cd /var/lib/forge/repos
git init --bare yeet.git
# Forge will install hook on first startup
```

15. **Test from local:**
```bash
cd ~/code/yeet
git remote add forge forge@135.181.179.143:repos/yeet.git
git push forge feature-branch
# Should appear at https://forge.justinmoon.com
```

---

## Summary

**This plan combines:**
- ✅ Proper Git plumbing (merge-tree, server-side merge)
- ✅ NixOS-native deployment (`just hetzner`)
- ✅ Bun/TypeScript stack
- ✅ Datastar SSR
- ✅ No "main" branches - master only
- ✅ Clean service data layout

## Post-receive Hook Template

For reference, the hook that will be installed in each bare repo:

```bash
#!/usr/bin/env bash
set -euo pipefail
zero=0000000000000000000000000000000000000000

while read -r oldrev newrev refname; do
  # ignore deletions
  [ "$newrev" = "$zero" ] && continue
  
  case "$refname" in
    refs/heads/*)
      # Notify forge
      curl -X POST http://localhost:3030/hooks/post-receive \
        -H 'Content-Type: application/json' \
        -d "{\"repo\":\"$PWD\",\"ref\":\"$refname\",\"oldrev\":\"$oldrev\",\"newrev\":\"$newrev\"}"
      ;;
  esac
done
```
