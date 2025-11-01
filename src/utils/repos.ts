import { readdirSync, statSync, existsSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import type { ForgeConfig } from '../types';

export function listRepos(reposPath: string): string[] {
  try {
    const entries = readdirSync(reposPath);
    const repos: string[] = [];

    for (const entry of entries) {
      const fullPath = join(reposPath, entry);
      if (statSync(fullPath).isDirectory() && entry.endsWith('.git')) {
        repos.push(entry.replace(/\.git$/, ''));
      }
    }

    return repos.sort();
  } catch (err) {
    return [];
  }
}

export function getRepoPath(reposPath: string, repoName: string): string {
  return join(reposPath, `${repoName}.git`);
}

export function validateRepoName(name: string): { valid: boolean; error?: string } {
  if (!name || name.length === 0) {
    return { valid: false, error: 'Repository name is required' };
  }

  if (name.length > 100) {
    return { valid: false, error: 'Repository name is too long (max 100 characters)' };
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    return { valid: false, error: 'Repository name can only contain letters, numbers, hyphens, and underscores' };
  }

  if (name.startsWith('-') || name.startsWith('_')) {
    return { valid: false, error: 'Repository name cannot start with - or _' };
  }

  return { valid: true };
}

export function createRepository(config: ForgeConfig, name: string): { success: boolean; error?: string } {
  const validation = validateRepoName(name);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  const repoPath = getRepoPath(config.reposPath, name);
  
  if (existsSync(repoPath)) {
    return { success: false, error: `Repository '${name}' already exists` };
  }

  try {
    execSync(`git init --bare "${repoPath}"`, { stdio: 'pipe' });
    
    const logsDir = join(config.logsPath, name);
    if (!existsSync(logsDir)) {
      mkdirSync(logsDir, { recursive: true });
    }

    installPostReceiveHook(repoPath, config);
    
    const symlinkPath = join(config.dataDir, `${name}.git`);
    const relativeTarget = join('repos', `${name}.git`);
    try {
      execSync(`ln -s "${relativeTarget}" "${symlinkPath}"`, { stdio: 'pipe', cwd: config.dataDir });
    } catch (symlinkError) {
      console.warn(`Warning: Failed to create symlink for SSH access: ${symlinkError}`);
    }
    
    return { success: true };
  } catch (error) {
    return { success: false, error: `Failed to create repository: ${error}` };
  }
}

export function deleteRepository(config: ForgeConfig, name: string): { success: boolean; error?: string } {
  const repoPath = getRepoPath(config.reposPath, name);
  
  if (!existsSync(repoPath)) {
    return { success: false, error: `Repository '${name}' does not exist` };
  }

  try {
    rmSync(repoPath, { recursive: true, force: true });
    
    const logsDir = join(config.logsPath, name);
    if (existsSync(logsDir)) {
      rmSync(logsDir, { recursive: true, force: true });
    }
    
    const symlinkPath = join(config.dataDir, `${name}.git`);
    if (existsSync(symlinkPath)) {
      rmSync(symlinkPath, { force: true });
    }
    
    return { success: true };
  } catch (error) {
    return { success: false, error: `Failed to delete repository: ${error}` };
  }
}

function installPostReceiveHook(repoPath: string, config: ForgeConfig): void {
  const hookPath = join(repoPath, 'hooks', 'post-receive');
  
  const baseUrl = config.domain 
    ? `https://${config.domain}` 
    : `http://localhost:${config.port}`;
  
  const hookScript = `#!/usr/bin/env bash
set -e

REPO_NAME=$(basename "$(pwd)" .git)

while read oldrev newrev refname; do
  BRANCH=\${refname#refs/heads/}
  DELETED=false
  
  if [ "$newrev" = "0000000000000000000000000000000000000000" ]; then
    DELETED=true
  fi

  curl -X POST ${baseUrl}/hooks/post-receive \\
    -H "Content-Type: application/json" \\
    -d "{\\"repo\\":\\"$REPO_NAME\\",\\"ref\\":\\"$refname\\",\\"oldrev\\":\\"$oldrev\\",\\"newrev\\":\\"$newrev\\",\\"deleted\\":$DELETED}" \\
    2>&1 | grep -v "^  % Total"
done
`;

  writeFileSync(hookPath, hookScript, { mode: 0o755 });
}
