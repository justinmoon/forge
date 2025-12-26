import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';
import { initDatabase } from '../src/db';
import type { ForgeConfig } from '../src/types';

export interface TestContext {
  tempDir: string;
  config: ForgeConfig;
  cleanup: () => void;
}

export function createTestContext(): TestContext {
  const tempDir = mkdtempSync(join(tmpdir(), 'forge-integration-'));
  const reposPath = join(tempDir, 'repos');
  const logsPath = join(tempDir, 'logs');
  const workPath = join(tempDir, 'work');
  const dbPath = join(tempDir, 'forge.db');

  execSync(`mkdir -p "${reposPath}" "${logsPath}" "${workPath}"`, { stdio: 'pipe' });

  initDatabase(dbPath);

  const config: ForgeConfig = {
    dataDir: tempDir,
    port: 0,
    allowedPubkeys: ['test-fixture-pubkey'], // Required in test mode
    reposPath,
    logsPath,
    dbPath,
    workPath,
    isDevelopment: true,
    trustProxy: false, // Tests run without proxy
    jobTimeout: 3600,
    jobTimeoutCheckInterval: 30000,
    container: {
      enabled: false,
      image: 'forge-ci:latest',
      network: 'slirp4netns',
      tmpfsSize: '2G',
      keepWorkdir: false,
    },
  };

  const cleanup = () => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch (err) {
      console.error('Failed to cleanup test context:', err);
    }
  };

  return { tempDir, config, cleanup };
}

export function createBareRepo(reposPath: string, repoName: string): string {
  const bareRepoPath = join(reposPath, `${repoName}.git`);
  execSync(`git init --bare "${bareRepoPath}"`, { stdio: 'pipe' });
  return bareRepoPath;
}

export function createWorkRepo(bareRepoPath: string, workDir: string): string {
  const workRepoPath = join(workDir, 'work-repo');
  execSync(`git clone "${bareRepoPath}" "${workRepoPath}"`, { stdio: 'pipe' });
  execSync('git config user.name "Test User"', { cwd: workRepoPath, stdio: 'pipe' });
  execSync('git config user.email "test@example.com"', { cwd: workRepoPath, stdio: 'pipe' });
  return workRepoPath;
}

export function seedRepo(workRepoPath: string, bareRepoPath: string): void {
  execSync('echo "# Test Repo" > README.md', { cwd: workRepoPath, stdio: 'pipe' });
  execSync('git add README.md', { cwd: workRepoPath, stdio: 'pipe' });
  execSync('git commit -m "Initial commit"', { cwd: workRepoPath, stdio: 'pipe' });
  execSync('git push origin master', { cwd: workRepoPath, stdio: 'pipe' });
}

export function createFeatureBranch(
  workRepoPath: string,
  branchName: string,
  content: string,
  commitMessage: string = `Add ${branchName}`
): void {
  execSync(`git checkout -b ${branchName}`, { cwd: workRepoPath, stdio: 'pipe' });
  execSync(`echo "${content}" >> README.md`, { cwd: workRepoPath, stdio: 'pipe' });
  execSync('git add README.md', { cwd: workRepoPath, stdio: 'pipe' });
  execSync(`git commit -m "${commitMessage}"`, { cwd: workRepoPath, stdio: 'pipe' });
  execSync(`git push origin ${branchName}`, { cwd: workRepoPath, stdio: 'pipe' });
  execSync('git checkout master', { cwd: workRepoPath, stdio: 'pipe' });
}

export async function waitForPort(port: number, timeout: number = 5000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const response = await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(100) });
      if (response.status) {
        return;
      }
    } catch (err) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error(`Server did not start on port ${port} within ${timeout}ms`);
}
