import type { ForgeConfig } from './types';
import { ensureDataDirectories } from './utils/config';
import { initDatabase } from './db';

export interface Server {
  port: number;
  stop: () => void;
}

export function startServer(config: ForgeConfig): Server {
  ensureDataDirectories(config);
  initDatabase(config.dbPath);

  const server = Bun.serve({
    port: config.port,
    fetch(req) {
      const url = new URL(req.url);
      
      if (url.pathname === '/') {
        return new Response('forge v0.1.0', {
          status: 200,
          headers: { 'Content-Type': 'text/plain' },
        });
      }

      return new Response('Not Found', { status: 404 });
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
