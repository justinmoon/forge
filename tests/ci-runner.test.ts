import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { writeFileSync, existsSync, readFileSync, mkdirSync, chmodSync } from 'fs';
import { join } from 'path';
import { createTestContext, createBareRepo, createWorkRepo, seedRepo, createFeatureBranch } from './helpers';
import { insertCIJob, getCIJob, updateCIJob } from '../src/db';
import { runPreMergeJob, cancelJob, isJobRunning, getCPUUsage } from '../src/ci/runner';
import type { TestContext } from './helpers';

describe('CI Runner', () => {
  let ctx: TestContext;
  let bareRepoPath: string;
  let workRepoPath: string;

  beforeAll(() => {
    ctx = createTestContext();
    bareRepoPath = createBareRepo(ctx.config.reposPath, 'test-repo');
    workRepoPath = createWorkRepo(bareRepoPath, ctx.tempDir);
    seedRepo(workRepoPath, bareRepoPath);
    createFeatureBranch(workRepoPath, 'feature-1', 'Feature 1 content');
  });

  afterAll(() => {
    ctx.cleanup();
  });

  test('CI runner creates worktree, runs command, and writes logs', async () => {
    const { execSync } = require('child_process');
    const headCommit = execSync('git rev-parse feature-1', {
      cwd: bareRepoPath,
      encoding: 'utf-8',
    }).trim();

    const logPath = join(ctx.config.logsPath, 'test-repo', `${headCommit}.log`);
    const statusPath = join(ctx.config.logsPath, 'test-repo', `${headCommit}.status`);

    const jobId = insertCIJob({
      repo: 'test-repo',
      branch: 'feature-1',
      headCommit,
      status: 'pending',
      logPath,
      startedAt: new Date(),
    });

    await runPreMergeJob(ctx.config, jobId, 'test-repo', 'feature-1', headCommit);

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(existsSync(logPath)).toBe(true);
    expect(existsSync(statusPath)).toBe(true);

    const job = getCIJob(jobId);
    expect(job).toBeTruthy();
    expect(job?.status).toMatch(/passed|failed/);
    expect(job?.finishedAt).toBeTruthy();

    const statusContent = readFileSync(statusPath, 'utf-8');
    const status = JSON.parse(statusContent);
    expect(status.jobId).toBe(jobId);
    expect(status.status).toMatch(/passed|failed/);
  }, 30000);

  test('CI runner prefers just when a pre-merge recipe exists', async () => {
    const { execSync } = require('child_process');
    const fakeBinDir = join(ctx.tempDir, 'fake-bin');
    mkdirSync(fakeBinDir, { recursive: true });

    const fakeJustPath = join(fakeBinDir, 'just');
    writeFileSync(
      fakeJustPath,
      '#!/usr/bin/env bash\n' +
        'set -euo pipefail\n' +
        'if [[ "$1" == "--list" ]]; then\n' +
        '  echo "Available recipes:"\n' +
        '  echo "  pre-merge"\n' +
        '  exit 0\n' +
        'fi\n' +
        'if [[ "$1" == "pre-merge" ]]; then\n' +
        '  echo "just pre-merge ran"\n' +
        '  exit 0\n' +
        'fi\n' +
        'echo "unexpected args: $*" >&2\n' +
        'exit 1\n'
    );
    chmodSync(fakeJustPath, 0o755);

    const originalPath = process.env.PATH ?? '';
    process.env.PATH = `${fakeBinDir}:${originalPath}`;

    try {
      execSync('git checkout -b just-feature', { cwd: workRepoPath, stdio: 'pipe' });
      writeFileSync(join(workRepoPath, 'justfile'), 'pre-merge:\n  echo "ok"\n');
      execSync('git add justfile', { cwd: workRepoPath, stdio: 'pipe' });
      execSync('git commit -m "Add justfile"', { cwd: workRepoPath, stdio: 'pipe' });
      execSync('git push origin just-feature', { cwd: workRepoPath, stdio: 'pipe' });

      const headCommit = execSync('git rev-parse just-feature', {
        cwd: bareRepoPath,
        encoding: 'utf-8',
      }).trim();

      const logPath = join(ctx.config.logsPath, 'test-repo', `${headCommit}.log`);

      const jobId = insertCIJob({
        repo: 'test-repo',
        branch: 'just-feature',
        headCommit,
        status: 'pending',
        logPath,
        startedAt: new Date(),
      });

      await runPreMergeJob(ctx.config, jobId, 'test-repo', 'just-feature', headCommit);

      const logContent = readFileSync(logPath, 'utf-8');
      expect(logContent).toContain('Forge: running just pre-merge');
      expect(logContent).toContain('just pre-merge ran');
    } finally {
      process.env.PATH = originalPath;
    }
  }, 30000);

  test('job cancellation works', async () => {
    const { execSync } = require('child_process');
    const headCommit = execSync('git rev-parse feature-1', {
      cwd: bareRepoPath,
      encoding: 'utf-8',
    }).trim();

    const logPath = join(ctx.config.logsPath, 'test-repo', `cancel-test.log`);

    const jobId = insertCIJob({
      repo: 'test-repo',
      branch: 'feature-1',
      headCommit,
      status: 'pending',
      logPath,
      startedAt: new Date(),
    });

    const runPromise = runPreMergeJob(ctx.config, jobId, 'test-repo', 'feature-1', headCommit);

    await new Promise((resolve) => setTimeout(resolve, 500));

    const wasRunning = isJobRunning(jobId);
    const canceled = cancelJob(jobId);

    await runPromise;

    const job = getCIJob(jobId);
    
    if (wasRunning) {
      expect(canceled).toBe(true);
      expect(job?.status).toBe('canceled');
    }
  }, 30000);
});
