# Forge User Guide

Push branches → pre-merge checks run → merge → post-merge actions run.

## Setup

Add a `justfile` (recommended):

```just
pre-merge:
  set -e
  echo "Running tests..."
  bun test
  echo "✓ Tests passed"

post-merge:
  set -e
  echo "Deploying..."
  ./deploy.sh
  echo "✓ Deployed"
```

Or expose Nix apps in `flake.nix`:

```nix
{
  description = "My project";

  outputs = { self, nixpkgs }:
    let
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};
    in
    {
      # Required: runs before merge is allowed
      apps.${system}.pre-merge = {
        type = "app";
        program = "${pkgs.writeShellScript "pre-merge" ''
          set -e
          echo "Running tests..."
          ${pkgs.bun}/bin/bun test
          echo "✓ Tests passed"
        ''}";
      };

      # Optional: runs after merge completes (for deploys, etc)
      apps.${system}.post-merge = {
        type = "app";
        program = "${pkgs.writeShellScript "post-merge" ''
          set -e
          echo "Deploying..."
          ./deploy.sh
          echo "✓ Deployed"
        ''}";
      };
    };
}
```

Test locally:
```bash
just pre-merge
just post-merge

# Or with Nix apps:
# nix run .#pre-merge
# nix run .#post-merge
```

## Workflow

1. **Push branch** → `pre-merge` runs automatically
2. **Pre-merge passes** → merge button enabled
3. **Click merge** → branch merges to master
4. **`post-merge` runs** on master (for deployments, notifications, etc)

View status: `https://forge.example.com/r/repo-name`

## Auto-Merge

Add to commit message:

```bash
git commit -m "Fix bug

Merge-After-CI: true"
```

Branch auto-merges when `pre-merge` passes, then `post-merge` runs.

## Examples

### Node.js Tests
```nix
apps.${system}.pre-merge = {
  type = "app";
  program = "${pkgs.writeShellScript "pre-merge" ''
    ${pkgs.nodejs}/bin/npm ci
    ${pkgs.nodejs}/bin/npm test
  ''}";
};
```

### Rust Tests
```nix
apps.${system}.pre-merge = {
  type = "app";
  program = "${pkgs.writeShellScript "pre-merge" ''
    ${pkgs.cargo}/bin/cargo test --all
    ${pkgs.cargo}/bin/cargo clippy -- -D warnings
  ''}";
};
```

### Deploy After Merge
```nix
apps.${system}.post-merge = {
  type = "app";
  program = "${pkgs.writeShellScript "post-merge" ''
    # Build
    ${pkgs.nix}/bin/nix build
    
    # Deploy via NixOS
    ${pkgs.nixos-rebuild}/bin/nixos-rebuild switch \
      --flake .#production \
      --target-host production.example.com
    
    # Notify
    ${pkgs.curl}/bin/curl -X POST https://hooks.slack.com/... \
      -d '{"text": "Deployed!"}'
  ''}";
};
```

## Debugging

**View logs:** `https://forge.example.com/jobs`

**Check your MR:** `https://forge.example.com/r/repo-name/mr/branch-name`

**Test locally:**
```bash
nix run .#pre-merge
nix run .#post-merge
```

**Common issues:**
- **"error: flake 'git+file://...' does not provide attribute 'apps.x86_64-linux.pre-merge'"** → Add `pre-merge` to your flake.nix, or add a `pre-merge` recipe to your `justfile`
- **Timeout** → Job took >5min, optimize or contact admin
- **Post-merge fails** → Doesn't block merge (already happened), check logs

## Notes

- **Pre-merge failures** block merging
- **Post-merge failures** don't block (merge already happened)
- Both run in isolated worktrees
- 5 minute timeout (default)
- 512MB RAM (default)

---

**Forge:** https://github.com/justinmoon/forge
