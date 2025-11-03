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

# Run e2e UI tests with Playwright
e2e:
    bunx playwright test

# Run a specific test file
test-file file:
    bun test {{file}}

# Run the server in development mode
dev:
    #!/usr/bin/env bash
    export NODE_ENV=development
    export DISABLE_AUTH=true
    export FORGE_DATA_DIR="./tmp/forge-dev"
    export FORGE_PORT=3030
    mkdir -p ./tmp/forge-dev
    bun run src/index.ts &
    sleep 2
    open http://localhost:3030
    wait

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
