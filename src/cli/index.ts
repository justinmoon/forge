#!/usr/bin/env bun

export {};

const command = process.argv[2];

function printHelp() {
  console.log(`forge v0.1.0 - Single-tenant Git forge

Usage:
  forge [command] [options]

Commands:
  status <repo> <branch>     Print MR fields, CI status, and merge eligibility
  wait-ci <repo> <branch>    Block until the latest CI run completes
  cancel-ci <job_id>         Cancel an active CI job (requires password)
  jobs                       List CI jobs (running first, then latest 100)
  --help, -h                 Show this help message
  --version, -v              Show version

Server:
  forge                      Start the HTTP server (default)
`);
}

if (command === '--help' || command === '-h' || command === 'help') {
  printHelp();
  process.exit(0);
}

if (command === '--version' || command === '-v') {
  console.log('0.1.0');
  process.exit(0);
}

if (!command) {
  await import('../index.js');
} else {
  console.log(`Command '${command}' not yet implemented. Use --help for usage.`);
  process.exit(1);
}
