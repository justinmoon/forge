import type { ForgeConfig } from './types';
import { ensureDataDirectories } from './utils/config';
import { initDatabase } from './db';
import { createRouter } from './http/router';
import { createHandlers } from './http/handlers';
import { createSessionMiddleware } from './http/middleware';

export interface Server {
  port: number;
  stop: () => void;
}

export function startServer(config: ForgeConfig): Server {
  ensureDataDirectories(config);
  initDatabase(config.dbPath);

  const router = createRouter();
  
  // We'll capture the Bun server instance to extract real client IPs
  let bunServer: any = null;
  const getDirectIP = (req: Request): string => {
    if (!bunServer) return 'unknown';
    // Use Bun's requestIP to get the actual TCP connection address
    const ipData = bunServer.requestIP(req);
    return ipData?.address || 'unknown';
  };
  
  const handlers = createHandlers(config, getDirectIP);

  // Apply session middleware to protect routes
  const sessionMiddleware = createSessionMiddleware(config);
  router.use(sessionMiddleware);

  // Auth routes (public)
  router.get('/login', handlers.getLogin);
  router.get('/auth/challenge', handlers.getAuthChallenge);
  router.post('/auth/verify', handlers.postAuthVerify);
  router.post('/logout', handlers.postLogout);

  // Protected routes
  router.get('/', handlers.getRoot);
  router.get('/create', handlers.getCreate);
  router.post('/create', handlers.postCreate);
  router.get('/r/:repo', handlers.getRepo);
  router.get('/r/:repo/delete', handlers.getDeleteConfirm);
  router.post('/r/:repo/delete', handlers.postDelete);
  router.get('/r/:repo/mr/:branch', handlers.getMergeRequest);
  router.get('/r/:repo/history', handlers.getHistory);
  router.get('/r/:repo/logs/:commit', handlers.getCILog);
  router.get('/jobs', handlers.getJobs);
  router.get('/jobs/:jobId', handlers.getJobDetail);
  router.post('/r/:repo/mr/:branch/merge', handlers.postMerge);
  router.post('/r/:repo/mr/:branch/delete', handlers.postDeleteBranch);
  router.post('/jobs/:jobId/cancel', handlers.postCancelJob);
  router.post('/hooks/post-receive', handlers.postReceive);

  bunServer = Bun.serve({
    port: config.port,
    fetch(req) {
      const start = Date.now();
      const url = new URL(req.url);
      
      console.log(`[${new Date().toISOString()}] ${req.method} ${url.pathname}`);
      
      const response = router.handle(req);
      
      const duration = Date.now() - start;
      console.log(`[${new Date().toISOString()}] ${req.method} ${url.pathname} - ${duration}ms`);
      
      return response;
    },
  });

  const actualPort = bunServer.port;
  if (!actualPort) {
    throw new Error('Failed to bind server to port');
  }

  return {
    port: actualPort,
    stop: () => bunServer.stop(),
  };
}
