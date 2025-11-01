import { getConfig, ensureDataDirectories } from './utils/config';

const config = getConfig();

console.log('forge server v0.1.0');
console.log(`Data directory: ${config.dataDir}`);
console.log(`Port: ${config.port}`);

ensureDataDirectories(config);

const server = Bun.serve({
  port: config.port,
  fetch(req) {
    return new Response('forge v0.1.0 - Server running', {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    });
  },
});

console.log(`Server listening on http://localhost:${server.port}`);

process.on('SIGINT', () => {
  console.log('\nShutting down gracefully...');
  server.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\nShutting down gracefully...');
  server.stop();
  process.exit(0);
});
