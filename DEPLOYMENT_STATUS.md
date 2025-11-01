# Forge Deployment Status

## What's Deployed:
- ✅ NixOS module created: `nix/module.nix`
- ✅ Hetzner config: `~/configs/hetzner/forge.nix`
- ✅ Caddy proxy: `forge.justinmoon.com` → `localhost:3040`
- ✅ All code committed to both repos

## Issue:
The `./update.sh` deployment started but may have hung due to SSH host key verification prompts.

## Manual Recovery Steps:

### 1. Check if deployment completed:
```bash
ssh justin@95.217.216.43 "sudo systemctl status forge"
```

### 2. If forge service exists but isn't running:
```bash
ssh justin@95.217.216.43 "sudo journalctl -u forge -n 50"
ssh justin@95.217.216.43 "sudo systemctl restart forge"
```

### 3. If forge service doesn't exist, complete the deployment:
```bash
cd ~/configs/hetzner
ssh justin@95.217.216.43 "pkill -9 nixos-rebuild" # Kill any hung rebuild
./update.sh 95.217.216.43  # Re-run deployment
```

### 4. Create test repository on server:
```bash
ssh justin@95.217.216.43 << 'ENDSSH'
sudo mkdir -p /var/lib/forge/repos/test-repo.git
cd /var/lib/forge/repos/test-repo.git
sudo git init --bare
sudo chown -R forge:forge /var/lib/forge
ENDSSH
```

### 5. Test locally by cloning and pushing:
```bash
git clone https://forge.justinmoon.com/repos/test-repo.git /tmp/test-repo
cd /tmp/test-repo
echo "# Test" > README.md
git add README.md
git commit -m "Initial commit"
git push origin master
```

## Playwright Production Test:

Once forge is up, run:
```bash
cd ~/code/forge
bunx playwright test tests/prod-smoke.spec.ts
```

The test will verify https://forge.justinmoon.com is responding.

## Expected Result:
- https://forge.justinmoon.com/ should show "Repositories" page
- Status check: `curl https://forge.justinmoon.com/` should return HTML with "forge" title
