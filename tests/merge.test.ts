import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { createTestContext, createBareRepo, createWorkRepo, seedRepo, createFeatureBranch, waitForPort } from './helpers';
import { startServer } from '../src/server';
import { branchExists, getHeadCommit } from '../src/git/branches';
import { getMergeHistory } from '../src/db';
import type { Server } from '../src/server';
import type { TestContext } from './helpers';

describe('Merge execution', () => {
  let ctx: TestContext;
  let server: Server;
  let bareRepoPath: string;
  let workRepoPath: string;

  beforeAll(async () => {
    ctx = createTestContext();
    
    bareRepoPath = createBareRepo(ctx.config.reposPath, 'test-repo');
    workRepoPath = createWorkRepo(bareRepoPath, ctx.tempDir);
    seedRepo(workRepoPath, bareRepoPath);
    createFeatureBranch(workRepoPath, 'feature-1', 'Feature 1 content');

    server = startServer(ctx.config);
    await waitForPort(server.port);
  });

  afterAll(() => {
    server.stop();
    ctx.cleanup();
  });

  test('merge fails without password', async () => {
    const response = await fetch(
      `http://localhost:${server.port}/r/test-repo/mr/feature-1/merge`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }
    );

    expect(response.status).toBe(401);
    const json = await response.json() as any;
    expect(json.error).toContain('Password required');
  });

  test('merge fails with wrong password', async () => {
    const response = await fetch(
      `http://localhost:${server.port}/r/test-repo/mr/feature-1/merge`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forge-Password': 'wrong-password',
        },
      }
    );

    expect(response.status).toBe(401);
    const json = await response.json() as any;
    expect(json.error).toContain('Invalid password');
  });

  test('merge fails when CI not passed', async () => {
    const response = await fetch(
      `http://localhost:${server.port}/r/test-repo/mr/feature-1/merge`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forge-Password': ctx.config.mergePassword,
        },
      }
    );

    expect(response.status).toBe(400);
    const json = await response.json() as any;
    expect(json.error).toContain('CI must pass');
  });

  test('merge succeeds when CI passed and branch is clean', async () => {
    const headCommit = getHeadCommit(bareRepoPath, 'feature-1');
    expect(headCommit).toBeTruthy();

    const logsDir = join(ctx.config.logsPath, 'test-repo');
    mkdirSync(logsDir, { recursive: true });
    
    const statusPath = join(logsDir, `${headCommit}.status`);
    writeFileSync(
      statusPath,
      JSON.stringify({
        status: 'passed',
        exitCode: 0,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
      })
    );

    expect(branchExists(bareRepoPath, 'feature-1')).toBe(true);

    const response = await fetch(
      `http://localhost:${server.port}/r/test-repo/mr/feature-1/merge`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forge-Password': ctx.config.mergePassword,
        },
      }
    );

    expect(response.status).toBe(200);
    const json = await response.json() as any;
    expect(json.success).toBe(true);
    expect(json.mergeCommit).toBeTruthy();
    expect(json.message).toContain('successful');

    expect(branchExists(bareRepoPath, 'feature-1')).toBe(false);

    const history = getMergeHistory('test-repo', 10);
    expect(history.length).toBe(1);
    expect(history[0].branch).toBe('feature-1');
    expect(history[0].repo).toBe('test-repo');
    expect(history[0].mergeCommit).toBe(json.mergeCommit);
    expect(history[0].ciStatus).toBe('passed');
  });

  test('merge fails for non-existent branch', async () => {
    const response = await fetch(
      `http://localhost:${server.port}/r/test-repo/mr/nonexistent/merge`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forge-Password': ctx.config.mergePassword,
        },
      }
    );

    expect(response.status).toBe(404);
    const json = await response.json() as any;
    expect(json.error).toContain('Branch not found');
  });
});
