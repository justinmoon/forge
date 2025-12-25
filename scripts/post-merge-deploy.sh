#!/usr/bin/env bash
set -euo pipefail

# This script runs after forge master is updated
# It creates an MR in the configs repo to update the forge flake input

CONFIGS_REPO="forge@forge.justinmoon.com:configs.git"
FORGE_COMMIT="${1:-$(git rev-parse HEAD)}"
WORK_DIR="/tmp/forge-deploy-$$"

# Configure git
export GIT_AUTHOR_NAME="Forge CI"
export GIT_AUTHOR_EMAIL="forge@forge.justinmoon.com"
export GIT_COMMITTER_NAME="Forge CI"
export GIT_COMMITTER_EMAIL="forge@forge.justinmoon.com"

echo "==> Post-merge: Deploying forge commit $FORGE_COMMIT to configs"

# Mirror to GitHub first (so configs can use github:justinmoon/forge as input)
echo "==> Mirroring to GitHub"
git push --mirror git@github.com:justinmoon/forge.git

# Clone configs repo
echo "==> Cloning configs repo"
git clone "$CONFIGS_REPO" "$WORK_DIR"
cd "$WORK_DIR"

# Create branch for this deployment
BRANCH_NAME="deploy-forge-${FORGE_COMMIT:0:8}"
echo "==> Creating branch $BRANCH_NAME"
git checkout -b "$BRANCH_NAME"

# Update forge flake input
echo "==> Updating forge flake input to commit $FORGE_COMMIT"
nix flake lock --update-input forge

# Check if there are changes
if git diff --quiet && git diff --cached --quiet; then
  echo "==> No changes detected, configs is already up to date"
  rm -rf "$WORK_DIR"
  exit 0
fi

# Commit and push
echo "==> Committing changes"
git add flake.lock
git commit -m "Deploy forge ${FORGE_COMMIT:0:8}

Auto-Merge: yes"

echo "==> Pushing branch"
git push origin "$BRANCH_NAME"

echo "==> Done! MR created: $BRANCH_NAME"
rm -rf "$WORK_DIR"
