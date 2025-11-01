import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { execSync } from 'child_process';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { createTestContext, createBareRepo, createWorkRepo, seedRepo, waitForPort } from './helpers';
import { startServer } from '../src/server';
import { branchExists } from '../src/git/branches';
import { getMergeHistory, getCIJob } from '../src/db';
import type { Server } from '../src/server';
import type { TestContext } from './helpers';

describe('Auto-merge with post-receive hook', () => {
  let ctx: TestContext;
  let server: Server;
  let bareRepoPath: string;
  let workRepoPath: string;

  beforeAll(async () => {
    ctx = createTestContext();
    
    bareRepoPath = createBareRepo(ctx.config.reposPath, 'test-repo');
    workRepoPath = createWorkRepo(bareRepoPath, ctx.tempDir);
    seedRepo(workRepoPath, bareRepoPath);

    execSync('git checkout -b auto-feature', { cwd: workRepoPath, stdio: 'pipe' });
    execSync('echo "Auto feature" >> README.md', { cwd: workRepoPath, stdio: 'pipe' });
    execSync('git add README.md', { cwd: workRepoPath, stdio: 'pipe' });
    execSync('git commit -m "Add auto feature\n\nForge-Auto-Merge: true"', { cwd: workRepoPath, stdio: 'pipe' });
    execSync('git push origin auto-feature', { cwd: workRepoPath, stdio: 'pipe' });

    server = startServer(ctx.config);
    await waitForPort(server.port);
  });

  afterAll(() => {
    server.stop();
    ctx.cleanup();
  });

  test('post-receive creates CI job and detects auto-merge trailer', async () => {
    const response = await fetch(
      `http://localhost:${server.port}/hooks/post-receive`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo: 'test-repo',
          ref: 'refs/heads/auto-feature',
          oldrev: '0000000000000000000000000000000000000000',
          newrev: 'abc123',
        }),
      }
    );

    expect(response.status).toBe(200);
    const json = await response.json() as any;
    expect(json.status).toBe('ok');
    expect(json.jobId).toBeGreaterThan(0);
    expect(json.autoMerge).toBe(true);

    const job = getCIJob(json.jobId);
    expect(job).toBeTruthy();
    expect(job?.repo).toBe('test-repo');
    expect(job?.branch).toBe('auto-feature');
    expect(job?.status).toBe('pending');
  });

  test('post-receive cancels pending jobs for same branch on new push', async () => {
    execSync('git checkout master', { cwd: workRepoPath, stdio: 'pipe' });
    execSync('git checkout -b cancel-test', { cwd: workRepoPath, stdio: 'pipe' });
    execSync('echo "Test 1" >> README.md', { cwd: workRepoPath, stdio: 'pipe' });
    execSync('git add README.md', { cwd: workRepoPath, stdio: 'pipe' });
    execSync('git commit -m "Test commit 1"', { cwd: workRepoPath, stdio: 'pipe' });
    execSync('git push origin cancel-test', { cwd: workRepoPath, stdio: 'pipe' });

    const firstResponse = await fetch(
      `http://localhost:${server.port}/hooks/post-receive`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo: 'test-repo',
          ref: 'refs/heads/cancel-test',
          oldrev: '0000000000000000000000000000000000000000',
          newrev: 'commit1',
        }),
      }
    );

    const first = await firstResponse.json() as any;
    const firstJobId = first.jobId;
    expect(firstJobId).toBeGreaterThan(0);

    execSync('echo "Test 2" >> README.md', { cwd: workRepoPath, stdio: 'pipe' });
    execSync('git add README.md', { cwd: workRepoPath, stdio: 'pipe' });
    execSync('git commit -m "Test commit 2"', { cwd: workRepoPath, stdio: 'pipe' });
    execSync('git push origin cancel-test', { cwd: workRepoPath, stdio: 'pipe' });

    const secondResponse = await fetch(
      `http://localhost:${server.port}/hooks/post-receive`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo: 'test-repo',
          ref: 'refs/heads/cancel-test',
          oldrev: 'commit1',
          newrev: 'commit2',
        }),
      }
    );

    const second = await secondResponse.json() as any;
    expect(second.jobId).toBeGreaterThan(firstJobId);

    const firstJob = getCIJob(firstJobId);
    expect(firstJob?.status).toBe('canceled');
  });

  test('post-receive handles branch deletion', async () => {
    await fetch(
      `http://localhost:${server.port}/hooks/post-receive`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo: 'test-repo',
          ref: 'refs/heads/deleted-branch',
          oldrev: 'abc123',
          newrev: '0000000000000000000000000000000000000000',
          deleted: true,
        }),
      }
    );

    const response = await fetch(
      `http://localhost:${server.port}/hooks/post-receive`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo: 'test-repo',
          ref: 'refs/heads/deleted-branch',
          oldrev: 'abc123',
          newrev: '0000000000000000000000000000000000000000',
          deleted: true,
        }),
      }
    );

    expect(response.status).toBe(200);
    const json = await response.json() as any;
    expect(json.message).toContain('deleted');
  });
});
