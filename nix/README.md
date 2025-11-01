# NixOS Deployment

This directory contains NixOS module and deployment configuration for forge.

## Quick Start

### 1. Add to your NixOS configuration

```nix
{ config, pkgs, ... }:

{
  imports = [
    /path/to/forge/nix/module.nix
  ];

  services.forge = {
    enable = true;
    domain = "forge.example.com";
    mergePassword = "your-secure-password";  # Use agenix/sops-nix in production
  };

  networking.firewall.allowedTCPPorts = [ 80 443 ];
}
```

### 2. Build and deploy

```bash
# Standard NixOS rebuild
nixos-rebuild switch

# Or with flakes
nixos-rebuild switch --flake .#hostname
```

## Configuration Options

### `services.forge.enable`
- Type: `boolean`
- Default: `false`
- Description: Enable the forge service

### `services.forge.package`
- Type: `package`
- Default: `pkgs.forge`
- Description: The forge package to use

### `services.forge.user` / `services.forge.group`
- Type: `string`
- Default: `"forge"` / `"forge"`
- Description: User and group under which forge runs

### `services.forge.dataDir`
- Type: `path`
- Default: `"/var/lib/forge"`
- Description: Directory for repos, database, and logs

### `services.forge.port`
- Type: `port`
- Default: `3030`
- Description: HTTP server port

### `services.forge.mergePassword`
- Type: `string`
- Default: `"changeme"`
- Description: Password for merge operations
- **WARNING**: Use secrets management in production (agenix/sops-nix)

### `services.forge.domain`
- Type: `null or string`
- Default: `null`
- Example: `"forge.example.com"`
- Description: Domain name (enables Caddy if set)

### `services.forge.enableCaddy`
- Type: `boolean`
- Default: `true` if `domain` is set
- Description: Enable Caddy reverse proxy with automatic HTTPS

## Architecture

```
forge/
├── nix/
│   ├── module.nix              # NixOS service module
│   ├── deployment-example.nix  # Example configuration
│   └── README.md               # This file
├── flake.nix                   # Nix flake with package definition
└── src/                        # Application source
```

## Secrets Management

**Never commit secrets to version control!**

### Using agenix

```nix
age.secrets.forge-password = {
  file = ../secrets/forge-password.age;
  owner = config.services.forge.user;
};

services.forge = {
  enable = true;
  mergePassword = config.age.secrets.forge-password.path;
};
```

### Using sops-nix

```nix
sops.secrets."forge/merge-password" = {
  owner = config.services.forge.user;
};

services.forge = {
  enable = true;
  mergePassword = config.sops.secrets."forge/merge-password".path;
};
```

## Post-receive Hook Setup

For auto-merge functionality, configure your Git repositories to call the forge post-receive hook:

```bash
# In your bare repository
cat > hooks/post-receive << 'EOF'
#!/usr/bin/env bash
curl -X POST http://localhost:3030/hooks/post-receive \
  -H "Content-Type: application/json" \
  -d "$(jq -n \
    --arg repo "$(basename $PWD .git)" \
    --arg ref "$1" \
    --arg oldrev "$2" \
    --arg newrev "$3" \
    '{repo: $repo, ref: $ref, oldrev: $oldrev, newrev: $newrev}')"
EOF

chmod +x hooks/post-receive
```

## Monitoring

Check service status:

```bash
systemctl status forge
journalctl -u forge -f
```

## Backup

Example with restic:

```nix
services.restic.backups.forge = {
  paths = [ config.services.forge.dataDir ];
  repository = "s3:bucket/forge-backups";
  passwordFile = "/etc/nixos/secrets/restic-password";
  timerConfig.OnCalendar = "daily";
};
```

## Troubleshooting

### Service won't start

```bash
# Check logs
journalctl -u forge -n 50

# Verify permissions
ls -la /var/lib/forge

# Test binary directly
sudo -u forge /nix/store/.../bin/forge --help
```

### Caddy not working

```bash
# Check Caddy status
systemctl status caddy

# Verify DNS
dig forge.example.com

# Check firewall
nix-shell -p nmap --run "nmap -p 80,443 localhost"
```

## Production Checklist

- [ ] Change default merge password
- [ ] Use secrets management (agenix/sops-nix)
- [ ] Enable firewall with allowed ports
- [ ] Configure backups
- [ ] Set up monitoring/alerting
- [ ] Configure post-receive hooks in repos
- [ ] Test auto-merge workflow
- [ ] Document CI integration
- [ ] Set up log rotation
- [ ] Test restore procedure

## License

See LICENSE file in repository root.
