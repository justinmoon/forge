import type { ForgeConfig } from './types';
import { ensureDataDirectories } from './utils/config';
import { initDatabase } from './db';
import { createRouter } from './http/router';
import { createHandlers } from './http/handlers';

export interface Server {
  port: number;
  stop: () => void;
}

export function startServer(config: ForgeConfig): Server {
  ensureDataDirectories(config);
  initDatabase(config.dbPath);

  const router = createRouter();
  const handlers = createHandlers(config);

  router.get('/', handlers.getRoot);
  router.get('/r/:repo', handlers.getRepo);
  router.get('/r/:repo/mr/:branch', handlers.getMergeRequest);
  router.get('/r/:repo/history', handlers.getHistory);
  router.get('/r/:repo/logs/:commit', handlers.getCILog);
  router.get('/jobs', handlers.getJobs);
  router.post('/r/:repo/mr/:branch/merge', handlers.postMerge);
  router.post('/jobs/:jobId/cancel', handlers.postCancelJob);
  router.post('/hooks/post-receive', handlers.postReceive);

  const server = Bun.serve({
    port: config.port,
    fetch(req) {
      const start = Date.now();
      const url = new URL(req.url);
      
      console.log(`${req.method} ${url.pathname}`);
      
      const response = router.handle(req);
      
      const duration = Date.now() - start;
      console.log(`${req.method} ${url.pathname} - ${duration}ms`);
      
      return response;
    },
  });

  const actualPort = server.port;
  if (!actualPort) {
    throw new Error('Failed to bind server to port');
  }

  return {
    port: actualPort,
    stop: () => server.stop(),
  };
}
