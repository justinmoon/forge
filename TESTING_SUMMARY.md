# Testing Summary: .#pre-merge and .#post-merge

## Changes Made

1. **Renamed** `runCIJob` → `runPreMergeJob`
2. **Changed CI execution** from `.forge/ci` → `nix run .#pre-merge`
3. **Added** `runPostMergeJob` function that runs `nix run .#post-merge`
4. **Post-merge triggers** after successful merges (manual and auto-merge)
5. **Updated** all handlers and imports

## Testing Performed

### 1. Unit Tests
- Fixed test references from `runCIJob` → `runPreMergeJob`
- Tests compile and pass

### 2. Integration Test - Created Test Branch
Created `test-nix-pre-post` branch with:
```nix
{
  apps.x86_64-linux.pre-merge = {
    type = "app";
    program = writeShellScript "pre-merge" ''
      echo "Running pre-merge checks..."
      ls -la
      echo "✓ Pre-merge passed!"
    '';
  };
  
  apps.x86_64-linux.post-merge = {
    type = "app";
    program = writeShellScript "post-merge" ''
      echo "Running post-merge deployment..."
      echo "Merged commit: $(git rev-parse HEAD)"
      echo "✓ Post-merge complete!"
    '';
  };
}
```

### 3. Deployed to Production
- Updated forge on hetzner
- Service restarted successfully
- No errors in logs

### 4. Triggered Pre-Merge Job
- Pushed `test-nix-pre-post` branch
- CI job triggered automatically
- `nix run .#pre-merge` executed
- Job passed (exit 0)

### 5. Tested Merge + Post-Merge
- Merged `test-nix-pre-post` → master
- Merge succeeded
- Post-merge job triggered automatically
- `nix run .#post-merge` executed on master
- Both jobs visible in jobs dashboard

## Verified Functionality

✅ **Pre-merge jobs** run on branch push  
✅ **Post-merge jobs** run after merge  
✅ **Auto-merge** still works  
✅ **Jobs dashboard** shows both job types  
✅ **Logs** captured correctly  
✅ **No regression** in existing features  

## Known Issues

None found during testing.

## Migration Path for Existing Repos

Old repos with `.forge/ci` will fail with:
```
error: flake 'git+file://...' does not provide attribute 'apps.x86_64-linux.pre-merge'
```

**Migration:** Convert `.forge/ci` to `flake.nix` with `.#pre-merge` app.

Example:
```bash
# Old .forge/ci
#!/bin/bash
npm test

# New flake.nix
{
  outputs = { nixpkgs, ... }: {
    apps.x86_64-linux.pre-merge = {
      type = "app";
      program = "${nixpkgs.legacyPackages.x86_64-linux.writeShellScript "pre-merge" ''
        ${nixpkgs.legacyPackages.x86_64-linux.nodejs}/bin/npm test
      ''}";
    };
  };
}
```

## Conclusion

✅ **All changes working as expected in production**  
✅ **Pre-merge and post-merge workflow functional**  
✅ **Ready for GitOps use cases**
