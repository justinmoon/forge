# Forge Production Status

## Deployment: ✅ SUCCESS

**URL:** https://forge.justinmoon.com  
**Server:** hetzner (135.181.179.143)  
**Service:** Running and stable

## What's Working

✅ **Core Infrastructure**
- NixOS service running (systemd)
- Caddy reverse proxy with HTTPS
- SQLite database initialized
- Server responding to HTTP requests
- Repository listing functional

✅ **Basic Functionality**
- Homepage loads and shows repositories
- Test repository (`test-repo`) visible
- Jobs dashboard accessible
- History pages load

✅ **Deployment**
- GitHub repo: https://github.com/justinmoon/forge
- Declarative Nix configuration via flake input
- Automatic deployment via `./update.sh`
- No manual steps required

## Known Issues

⚠️ **Git Safe Directory Configuration**
- **Issue:** Service cannot read branches from repositories
- **Symptom:** "No active merge requests" even though branches exist
- **Cause:** Systemd service doesn't inherit git safe.directory config
- **Impact:** MR workflow and CI not functional yet
- **Status:** Needs systemd service config update

### Verification

```bash
# Branches exist in repo
$ ssh hetzner 'sudo -u forge git -C /var/lib/forge/repos/test-repo.git branch -a'
  feature-branch
* master

# But forge service can't see them
$ curl https://forge.justinmoon.com/r/test-repo
# Shows: "No active merge requests"
```

### Root Cause

The forge service runs as the `forge` user under systemd. While the forge user has git config at `/var/lib/forge/.gitconfig` with:
```
[safe]
    directory = /var/lib/forge/repos/*
```

The systemd service environment doesn't properly pass this to git commands. The service needs either:
1. Explicit `HOME=/var/lib/forge` in service environment
2. Or `GIT_CONFIG_GLOBAL` environment variable
3. Or system-wide git config

### Fix Required

Update `~/configs/hetzner/forge.nix` or the NixOS module to add to service environment:
```nix
systemd.services.forge.environment = {
  HOME = "/var/lib/forge";
  GIT_CONFIG_GLOBAL = "/var/lib/forge/.gitconfig";
};
```

## Testing Status

### Completed Tests

✅ **Production Smoke Test**
```bash
cd ~/code/forge
bunx playwright test tests/prod-smoke.spec.ts
# PASSING - HTTP 200, homepage loads
```

✅ **Manual Verification**
- Repository created on server
- Branches pushed successfully  
- Service logs clean (no crashes)

### Pending Tests

❌ **Merge Request Workflow**
- Blocked by git safe.directory issue
- Cannot test: branch listing, MR pages, merge execution

❌ **CI Integration**
- Blocked by git safe.directory issue
- Cannot test: CI job creation, worktree execution, auto-merge

## Next Steps

1. **Fix git configuration** - Update NixOS module with proper environment
2. **Redeploy** - `cd ~/configs && nix flake lock --update-input forge && cd hetzner && ./update.sh 135.181.179.143`
3. **Test MR workflow** - Create branch, verify it appears, test merge
4. **Test CI** - Add `.forge/ci` script to test repo, trigger CI job
5. **Document** - Update with CI test results

## Summary

**Deployment:** ✅ Complete  
**Core Service:** ✅ Working  
**Git Integration:** ⚠️  Needs environment fix  
**Full Workflow:** ❓ Not yet tested

The forge is successfully deployed and the service is stable. One configuration fix is needed to enable the full MR and CI workflow.
