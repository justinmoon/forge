# Agent Guide: Working with Forge

## Creating Merge Requests

Push a feature branch. MR is created automatically:

```bash
git checkout -b my-feature
git commit -m "Add feature"
git push origin my-feature
```

View at: `https://forge.justinmoon.com/r/<repo>`

## Checking CI Status

### Web UI
- MR page: `https://forge.justinmoon.com/r/<repo>/mr/<branch>`
- Jobs dashboard: `https://forge.justinmoon.com/jobs`
- Job detail with logs: `https://forge.justinmoon.com/jobs/<job-id>`

### CLI

**Important**: The forge CLI must be run as the `forge` user (the service account that owns the database and repositories). Use `sudo -u forge`:

```bash
ssh <host> 'sudo -u forge forge jobs list'              # List recent jobs
ssh <host> 'sudo -u forge forge jobs show <job-id>'     # Show job details
ssh <host> 'sudo -u forge forge status <repo> <branch>' # Check MR status
ssh <host> 'sudo -u forge forge watch-ci <repo> <branch>' # Block until CI completes

# Or check systemd logs:
ssh <host> 'sudo journalctl -u forge.service -f'
```

**Why `sudo -u forge`?**
- The forge database and repositories are owned by the `forge` user
- The `forge` user runs with a restricted `git-shell` (can't SSH directly)
- Regular users don't have read access to `/var/lib/forge`

## Configuring CI

### Pre-Merge (runs on feature branch pushes)

Add to `flake.nix`:

```nix
outputs = { self, nixpkgs, ... }: {
  apps.x86_64-linux.pre-merge = {
    type = "app";
    program = toString (pkgs.writeShellScript "pre-merge" ''
      set -e
      # Your validation here
      nix flake check
      # Or run tests, linters, etc
    '');
  };
};
```

### Post-Merge (runs on master updates)

Add to `flake.nix`:

```nix
outputs = { self, nixpkgs, ... }: {
  apps.x86_64-linux.post-merge = {
    type = "app";
    program = toString (pkgs.writeShellScript "post-merge" ''
      set -e
      # Deployment, notifications, etc
      echo "Deployed successfully"
    '');
  };
};
```

## Auto-Merge

Add trailer to commit message:

```
My commit message

Auto-Merge: yes
```

Requirements for auto-merge:
- CI must pass
- No merge conflicts
- Trailer present in head commit

Alternative trailer (also supported):
```
Forge-Auto-Merge: true
```

## Merging Manually

Web UI method:
1. Go to MR page
2. Wait for CI to pass
3. Click "Merge to master"
4. Enter password

API method:
```bash
curl -X POST https://forge.justinmoon.com/r/<repo>/mr/<branch>/merge \
  -H "X-Forge-Password: <password>"
```

## Repository Structure

```
repos/          # Bare git repositories
logs/           # CI logs: logs/<repo>/<commit>.log
work/           # Temporary worktrees for CI runs
forge.db        # SQLite database (merge history, CI jobs)
```

## SSH Access

Clone repositories:
```bash
git clone forge@forge.justinmoon.com:<repo>.git
```

Push/pull:
```bash
git push forge master
git push forge my-feature
```

## Logs

- **Pre-merge logs**: `logs/<repo>/<commit>.log`
- **Post-merge logs**: `logs/<repo>/<commit>-post-merge.log`
- **Status files**: `logs/<repo>/<commit>.status` (JSON)

View logs via web: `https://forge.justinmoon.com/jobs/<job-id>`

## Common Workflows

### Feature Development
```bash
git checkout -b feature-x
# Make changes
git commit -m "Add feature X\n\nAuto-Merge: yes"
git push origin feature-x
# CI runs automatically
# Auto-merges if CI passes
```

### Check Why CI Failed
```bash
# Web: https://forge.justinmoon.com/jobs/<job-id>
# Or SSH:
ssh host 'sudo -u forge cat /var/lib/forge/logs/<repo>/<commit>.log'
# Or use the CLI:
ssh host 'sudo -u forge forge jobs show <job-id>'
```

### Cancel Running Job
Web UI: Jobs dashboard → Cancel button (requires password)

### Delete Repository
```bash
# CLI:
forge delete <repo>

# Web:
# Go to repo page → Delete link → Confirm
```

## Password Authentication

All destructive operations require password:
- Creating repositories
- Deleting repositories  
- Merging branches
- Canceling jobs

Password sent via:
- Web forms
- `X-Forge-Password` header (API)
- CLI prompts

## CI Environment

Runs in git worktree with:
- Working copy at: `/var/lib/forge/work/<repo>/<job-id>`
- Clean environment (no persistent state)
- Nix available
- Git available
- stdout/stderr captured to log file

Exit code 0 = pass, non-zero = fail

## Limitations

- No per-user authentication (single password)
- No CI approval workflow
- No secrets management integration
- No web-based log streaming (refresh to see updates)
- Master branch is protected (no direct push)

## Tips for Agents

1. **Always add pre-merge CI** - Prevents broken code from merging
2. **Use Auto-Merge trailer** - Enables full GitOps automation
3. **Keep CI fast** - Use `nix flake show` instead of full `nix flake check` for large repos
4. **Check logs on failure** - Web UI shows full logs with ANSI colors
5. **SSH access works like GitHub** - Standard git operations
