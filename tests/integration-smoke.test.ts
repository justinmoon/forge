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
    
    const json = await response.json() as any;
    expect(json.error).toBeTruthy();
  });

  test('GET / returns HTML repo list placeholder', async () => {
    const response = await fetch(`http://localhost:${server.port}/`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    
    const html = await response.text();
    expect(html).toContain('forge');
    expect(html).toContain('Repository list');
  });

  test('GET /r/:repo returns HTML MR list placeholder', async () => {
    const response = await fetch(`http://localhost:${server.port}/r/test-repo`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    
    const html = await response.text();
    expect(html).toContain('test-repo');
    expect(html).toContain('Merge request list');
  });

  test('GET /r/:repo/mr/:branch returns HTML MR detail placeholder', async () => {
    const response = await fetch(`http://localhost:${server.port}/r/test-repo/mr/feature-1`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    
    const html = await response.text();
    expect(html).toContain('test-repo');
    expect(html).toContain('feature-1');
    expect(html).toContain('MR detail');
  });

  test('GET /r/:repo/history returns HTML history placeholder', async () => {
    const response = await fetch(`http://localhost:${server.port}/r/test-repo/history`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    
    const html = await response.text();
    expect(html).toContain('test-repo');
    expect(html).toContain('history');
  });

  test('GET /jobs returns HTML jobs dashboard placeholder', async () => {
    const response = await fetch(`http://localhost:${server.port}/jobs`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    
    const html = await response.text();
    expect(html).toContain('CI Jobs');
  });

  test('POST /hooks/post-receive accepts JSON payload', async () => {
    const response = await fetch(`http://localhost:${server.port}/hooks/post-receive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repo: 'test-repo',
        ref: 'refs/heads/feature-1',
        oldrev: '0000000000000000000000000000000000000000',
        newrev: 'abc123',
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    
    const json = await response.json() as any;
    expect(json.status).toBe('ok');
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
