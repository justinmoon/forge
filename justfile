# Development commands for forge

# Show available commands
default:
    @just --list

# Run type checking
check:
    ./node_modules/.bin/tsc --noEmit

# Run tests
test:
    bun test

# Run a specific test file
test-file file:
    bun test {{file}}

# Run the server in development mode
dev:
    bun run src/index.ts

# Run the server (alias for dev)
start: dev

# Run the CLI with arguments
cli *args:
    bun run src/cli/index.ts {{args}}

# Build via nix
build:
    nix build .#forge

# Run via nix
run:
    nix run .#forge

# Enter development shell
shell:
    nix develop
