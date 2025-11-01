# Forge Security

## Merge Password

### Current Status

✅ **Security Fix Applied:** The default `'changeme'` fallback has been removed. The service will now **fail to start** if `FORGE_MERGE_PASSWORD` is not explicitly set.

### Configuration

The merge password is configured in your NixOS module:

```nix
services.forge = {
  mergePassword = "your-password-here";
};
```

⚠️ **WARNING:** Storing passwords in plaintext in your NixOS configuration is **not recommended** for production use. The password will be:
- Visible in your git repository
- Accessible in `/nix/store/`
- Visible in `systemctl show forge`

### Recommended: Use Secrets Management

For production deployments, use proper secrets management:

#### Option 1: agenix (Recommended)

```nix
# In your configuration.nix
age.secrets.forge-password = {
  file = ./secrets/forge-password.age;
  owner = "forge";
};

services.forge = {
  mergePasswordFile = config.age.secrets.forge-password.path;
};
```

Then update the NixOS module to support `mergePasswordFile`:

```nix
# In nix/module.nix
mergePasswordFile = mkOption {
  type = types.nullOr types.path;
  default = null;
  description = "Path to file containing merge password (more secure than mergePassword)";
};

# In service environment:
environment = {
  FORGE_MERGE_PASSWORD = 
    if cfg.mergePasswordFile != null
    then "$(cat ${cfg.mergePasswordFile})"
    else cfg.mergePassword;
};
```

#### Option 2: sops-nix

```nix
sops.secrets.forge-password = {
  sopsFile = ./secrets.yaml;
  owner = "forge";
};

services.forge = {
  mergePasswordFile = config.sops.secrets.forge-password.path;
};
```

#### Option 3: External Secret Store

Use systemd's `LoadCredential` to load secrets:

```nix
systemd.services.forge = {
  serviceConfig = {
    LoadCredential = "forge-password:/run/secrets/forge-password";
  };
  environment = {
    FORGE_MERGE_PASSWORD = "\${CREDENTIALS_DIRECTORY}/forge-password";
  };
};
```

### Password Requirements

- Must be set (no default fallback)
- Should be strong and unique
- Rotate regularly
- Do not commit to git in plaintext

### API Authentication

The merge password is required for:
- `POST /r/{repo}/mr/{branch}/merge` - Manual merges
- `POST /jobs/{id}/cancel` - Job cancellation

Pass it via the `X-Forge-Password` header:

```bash
curl -X POST https://forge.example.com/r/myrepo/mr/mybranch/merge \
  -H "Content-Type: application/json" \
  -H "X-Forge-Password: your-password-here"
```

### Security Checklist

- [ ] Remove default `'changeme'` password (✅ Done)
- [ ] Use strong, unique password
- [ ] Implement secrets management (agenix/sops-nix)
- [ ] Remove password from git history
- [ ] Enable HTTPS (Caddy handles this)
- [ ] Restrict access to merge endpoints
- [ ] Rotate password periodically
- [ ] Monitor for unauthorized access attempts
- [ ] Use restrictive file permissions on password files

## Other Security Considerations

### Systemd Hardening

The forge service includes security hardening:
- `ProtectSystem=strict` - Read-only system directories
- `ProtectHome=true` - No access to user home directories
- `PrivateTmp=true` - Private /tmp namespace
- `NoNewPrivileges=true` - Cannot gain new privileges
- `PrivateDevices=true` - No access to devices
- `RestrictAddressFamilies` - Limited network protocols

### Repository Access

- Repositories are stored in `/var/lib/forge/repos/`
- Owned by `forge:forge` user/group
- No authentication for read access currently
- Git push access depends on your git hosting setup

### CI Execution

- CI scripts run in isolated worktrees
- Runs as `forge` user (not root)
- No network isolation currently (future enhancement)
- Scripts can access repository contents
- Be careful with untrusted CI scripts

## Reporting Security Issues

If you discover a security issue, please:
1. Do NOT open a public GitHub issue
2. Email security concerns privately
3. Include detailed reproduction steps
4. Allow time for patch before disclosure
