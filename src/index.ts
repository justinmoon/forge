import { getConfig } from './utils/config';
import { startServer } from './server';
import { startJobTimeoutMonitor, stopJobTimeoutMonitor } from './ci/runner';

const config = getConfig(true); // Server requires password

console.log('forge server v0.1.0');
console.log(`Data directory: ${config.dataDir}`);
console.log(`Port: ${config.port}`);

const server = startServer(config);

console.log(`Server listening on http://localhost:${server.port}`);

// Start job timeout monitor
startJobTimeoutMonitor(config);

process.on('SIGINT', () => {
  console.log('\nShutting down gracefully...');
  stopJobTimeoutMonitor();
  server.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\nShutting down gracefully...');
  stopJobTimeoutMonitor();
  server.stop();
  process.exit(0);
});
