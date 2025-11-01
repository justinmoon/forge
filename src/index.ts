import { getConfig } from './utils/config';
import { startServer } from './server';

const config = getConfig();

console.log('forge server v0.1.0');
console.log(`Data directory: ${config.dataDir}`);
console.log(`Port: ${config.port}`);

const server = startServer(config);

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
