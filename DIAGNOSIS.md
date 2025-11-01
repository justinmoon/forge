# Diff Viewer Deployment Diagnosis

## Problem
The diff viewer code was successfully merged to forge master but is not deployed to production.

## Root Causes Discovered

### 1. Auto-Merge Doesn't Trigger Post-Merge ✅ FIXED
**Issue**: The `tryAutoMerge` function successfully merged branches but didn't trigger post-merge jobs.

**Impact**: When configs auto-merged, no deployment happened.

**Fix**: Added `runPostMergeJob` call in `src/ci/auto-merge.ts` (commit b7b8f45)

### 2. Configs Post-Merge Script Was a No-Op ✅ FIXED  
**Issue**: `scripts/post-merge-deploy.sh` only logged messages, didn't actually deploy.

**Impact**: Even if post-merge ran, nothing would happen.

**Fix**: Updated script to SSH and run `nixos-rebuild switch` (configs commit 09f3600)

### 3. NixOS Configuration Build is Broken ❌ CRITICAL
**Issue**: Building configs with updated forge input (c26e93c) completely removes the forge service.

**Evidence**:
- Generation 459: forge.service running normally
- Generation 460: forge.service doesn't exist, user/group removed
- Deployment log shows: "removing group 'forge'" and "removing user 'forge'"

**Impact**: Cannot deploy new forge code - the service disappears!

**Status**: BLOCKING - rolled back to generation 459

## Current State
- **Forge**: Running on OLD code from `/nix/store/1kn7anwh0qc95085dw3g800l45ygkf4m-forge-0.1.0`
- **NixOS**: Generation 459 (last working state)  
- **Diff Viewer**: NOT deployed, not accessible

## What Needs to Happen

1. **Debug NixOS Configuration**
   - Compare generation 459 vs 460 configs
   - Check why forge module isn't being applied
   - Verify forge input in flake.lock
   - Check hetzner/configuration.nix imports

2. **Fix and Test Configs**
   - Fix whatever is breaking the forge service
   - Test build locally if possible
   - Push fix with Auto-Merge enabled

3. **Complete GitOps Flow**
   - Forge merge → post-merge creates configs MR
   - Configs auto-merge → post-merge deploys
   - Verify forge restarts with new code
   - Test diff viewer works

## Files Modified

### Forge Repo
- `src/ci/auto-merge.ts` - Triggers post-merge after auto-merge
- `src/git/diff-parser.ts` - NEW - Diff parsing logic
- `src/views/diff.ts` - NEW - Diff HTML renderer
- `src/views/diff-scripts.ts` - NEW - Client-side JS
- `src/views/layout.ts` - Added diff CSS styles
- `src/views/merge-requests.ts` - Uses new diff renderer

### Configs Repo
- `scripts/post-merge-deploy.sh` - Automated deployment via SSH

## Git State

**Forge**:
- master: b7b8f45 (has auto-merge fix + diff viewer)
- Deployed: NEW code with diff viewer! ✅

**Configs**:
- master: a1293a3/09f3600 (has post-merge deployment)
- forge input: c26e93c (diff viewer merge)
- NixOS: Generation 461 (working with new forge!)

## Resolution

Bug #3 was: **Server's gitops configs repo pointed to GitHub instead of forge**

The server's `/var/lib/gitops/configs` had origin set to `git@github.com:justinmoon/configs.git`
which was outdated and missing the forge.nix file entirely.

Fixed by:
1. Changing remote: `sudo git -C /var/lib/gitops/configs remote set-url origin forge@forge.justinmoon.com:configs.git`
2. Fetching latest: `sudo git fetch origin && sudo git reset --hard origin/master`
3. Deploying: `sudo nixos-rebuild switch --flake .#hetzner`

Now the diff viewer is deployed and running!
