# Forge

A minimal, single-tenant Git forge with merge requests and CI.

## What it does

- Lists Git repositories and branches
- Shows merge requests with diff previews
- Runs CI jobs via `nix run .#ci`
- Merges branches after CI passes
- Auto-merges when commits include `Forge-Auto-Merge: true` trailer

## Quick start

```bash
# Build and run
nix run

# Deploy to NixOS
just hetzner
```

## Configuration

Forge runs as a systemd service on NixOS and requires:
- `FORGE_MERGE_PASSWORD` - password for merge operations
- `/var/lib/forge/repos/*.git` - bare Git repositories
- `/var/lib/forge/forge.db` - SQLite database

See `docs/spec.md` for full details.

## Development

```bash
bun install
bun test
```

## Documentation

- `docs/spec.md` - Complete specification
- `docs/USER_GUIDE.md` - User guide
- `docs/agents.md` - AI agent instructions
- `nix/README.md` - NixOS module details
