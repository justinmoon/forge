import { getConfig } from './utils/config';
import { startServer } from './server';
import { startJobTimeoutMonitor, stopJobTimeoutMonitor } from './ci/runner';
import { recoverOrphanedJobs } from './db';

const config = getConfig(true); // Server requires password

console.log('forge server v0.1.0');
console.log(`Data directory: ${config.dataDir}`);
console.log(`Port: ${config.port}`);

const server = startServer(config);

// Recover any jobs orphaned by server restart (e.g., during nixos-rebuild)
const recovered = recoverOrphanedJobs();
if (recovered > 0) {
  console.log(`Recovered ${recovered} orphaned job(s)`);
}

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
