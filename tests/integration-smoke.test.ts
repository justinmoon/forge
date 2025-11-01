import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { createTestContext, createBareRepo, createWorkRepo, seedRepo, createFeatureBranch, waitForPort } from './helpers';
import { startServer } from '../src/server';
import type { Server } from '../src/server';
import type { TestContext } from './helpers';

describe('Integration smoke tests', () => {
  let ctx: TestContext;
  let server: Server;

  beforeAll(async () => {
    ctx = createTestContext();
    
    const bareRepo = createBareRepo(ctx.config.reposPath, 'test-repo');
    const workRepo = createWorkRepo(bareRepo, ctx.tempDir);
    seedRepo(workRepo, bareRepo);
    createFeatureBranch(workRepo, 'feature-1', 'Feature 1 content');

    server = startServer(ctx.config);
    await waitForPort(server.port);
  });

  afterAll(() => {
    server.stop();
    ctx.cleanup();
  });

  test('server starts and responds on ephemeral port', async () => {
    expect(server.port).toBeGreaterThan(0);
    
    const response = await fetch(`http://localhost:${server.port}/`);
    expect(response.status).toBe(200);
    
    const text = await response.text();
    expect(text).toContain('forge');
  });

  test('server returns 404 for unknown routes', async () => {
    const response = await fetch(`http://localhost:${server.port}/unknown`);
    expect(response.status).toBe(404);
  });

  test('temp repos are created and accessible', () => {
    const { existsSync } = require('fs');
    const { join } = require('path');
    
    const bareRepoPath = join(ctx.config.reposPath, 'test-repo.git');
    expect(existsSync(bareRepoPath)).toBe(true);
    expect(existsSync(join(bareRepoPath, 'refs'))).toBe(true);
    expect(existsSync(join(bareRepoPath, 'objects'))).toBe(true);
  });

  test('database is initialized', () => {
    const { existsSync } = require('fs');
    expect(existsSync(ctx.config.dbPath)).toBe(true);
  });

  test('data directories are created', () => {
    const { existsSync } = require('fs');
    expect(existsSync(ctx.config.reposPath)).toBe(true);
    expect(existsSync(ctx.config.logsPath)).toBe(true);
    expect(existsSync(ctx.config.workPath)).toBe(true);
  });
});
