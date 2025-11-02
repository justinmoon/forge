#!/usr/bin/env bun

export {};

import { getConfig } from '../utils/config';
import { getRepoPath, createRepository, deleteRepository } from '../utils/repos';
import { getMergeMetadata } from '../git/merge';
import { getCIStatus } from '../ci/status';
import { hasAutoMergeTrailer } from '../git/trailers';
import { initDatabase, listCIJobs, getLatestCIJob, getCIJob } from '../db';
import { getCPUUsage } from '../ci/runner';

const command = process.argv[2];

function printHelp() {
  console.log(`forge v0.1.0 - Single-tenant Git forge

Usage:
  forge [command] [options]

Commands:
  create <repo>              Create a new repository with post-receive hook
  delete <repo>              Delete a repository (prompts for confirmation)
  status <repo> <branch>     Print MR fields, CI status, and merge eligibility
  wait-ci <repo> <branch>    Block until the latest CI run completes
  cancel-ci <job_id>         Cancel an active CI job (requires password)
  jobs                       List CI jobs (running first, then latest 100)
  --help, -h                 Show this help message
  --version, -v              Show version
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
  printHelp();
  process.exit(0);
} else if (command === 'create') {
  const repoName = process.argv[3];

  if (!repoName) {
    console.error('Usage: forge create <repo-name>');
    process.exit(1);
  }

  const config = getConfig();
  const result = createRepository(config, repoName);

  if (!result.success) {
    console.error(`Error: ${result.error}`);
    process.exit(1);
  }

  const cloneUrl = config.domain 
    ? `forge@${config.domain}:${repoName}.git`
    : `git@localhost:${repoName}.git`;

  console.log(`✓ Created repository: ${repoName}`);
  console.log(`✓ Installed post-receive hook`);
  console.log(`\nClone with:`);
  console.log(`  git clone ${cloneUrl}`);
  console.log(`\nView at:`);
  const webUrl = config.domain 
    ? `https://${config.domain}/r/${repoName}`
    : `http://localhost:${config.port}/r/${repoName}`;
  console.log(`  ${webUrl}`);

  process.exit(0);
} else if (command === 'delete') {
  const repoName = process.argv[3];

  if (!repoName) {
    console.error('Usage: forge delete <repo-name>');
    process.exit(1);
  }

  console.log(`WARNING: This will permanently delete repository '${repoName}' and all its data.`);
  console.log('Type the repository name to confirm:');
  
  process.stdout.write('> ');
  
  const readline = require('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  rl.question('', (answer: string) => {
    rl.close();
    
    if (answer.trim() !== repoName) {
      console.log('Deletion canceled.');
      process.exit(0);
    }

    const config = getConfig();
    const result = deleteRepository(config, repoName);

    if (!result.success) {
      console.error(`Error: ${result.error}`);
      process.exit(1);
    }

    console.log(`✓ Deleted repository: ${repoName}`);
    process.exit(0);
  });
} else if (command === 'status') {
  const repo = process.argv[3];
  const branch = process.argv[4];

  if (!repo || !branch) {
    console.error('Usage: forge status <repo> <branch>');
    process.exit(1);
  }

  const config = getConfig();
  initDatabase(config.dbPath);

  const repoPath = getRepoPath(config.reposPath, repo);
  const metadata = getMergeMetadata(repoPath, branch);

  if (!metadata) {
    console.error(`Branch '${branch}' not found in repo '${repo}'`);
    process.exit(1);
  }

  const ciStatus = getCIStatus(config.logsPath, repo, branch, metadata.headCommit);
  const autoMerge = hasAutoMergeTrailer(repoPath, metadata.headCommit);

  console.log(`Repository: ${repo}`);
  console.log(`Branch: ${branch}`);
  console.log(`Head commit: ${metadata.headCommit.slice(0, 8)}`);
  console.log(`Merge base: ${metadata.mergeBase.slice(0, 8)}`);
  console.log(`Ahead: ${metadata.aheadCount} | Behind: ${metadata.behindCount}`);
  console.log(`Conflicts: ${metadata.hasConflicts ? 'YES' : 'NO'}`);
  console.log(`CI Status: ${ciStatus}`);
  console.log(`Auto-merge: ${autoMerge ? 'YES' : 'NO'}`);
  console.log(`Merge eligible: ${ciStatus === 'passed' && !metadata.hasConflicts ? 'YES' : 'NO'}`);

  process.exit(0);
} else if (command === 'wait-ci') {
  const repo = process.argv[3];
  const branch = process.argv[4];

  if (!repo || !branch) {
    console.error('Usage: forge wait-ci <repo> <branch>');
    process.exit(1);
  }

  const config = getConfig();
  initDatabase(config.dbPath);

  const repoPath = getRepoPath(config.reposPath, repo);
  const metadata = getMergeMetadata(repoPath, branch);

  if (!metadata) {
    console.error(`Branch '${branch}' not found in repo '${repo}'`);
    process.exit(1);
  }

  console.log(`Waiting for CI to complete for ${repo}/${branch}...`);

  const checkInterval = setInterval(() => {
    const job = getLatestCIJob(repo, branch, metadata.headCommit);
    
    if (job && (job.status === 'passed' || job.status === 'failed' || job.status === 'canceled')) {
      clearInterval(checkInterval);
      console.log(`CI completed with status: ${job.status}`);
      process.exit(job.status === 'passed' ? 0 : 1);
    }
  }, 1000);
} else if (command === 'cancel-ci') {
  const jobIdStr = process.argv[3];

  if (!jobIdStr) {
    console.error('Usage: forge cancel-ci <job_id>');
    process.exit(1);
  }

  const jobId = parseInt(jobIdStr, 10);
  if (isNaN(jobId)) {
    console.error('Invalid job ID');
    process.exit(1);
  }

  console.error('CLI job cancellation requires server API call');
  console.error('Use: curl -X POST -H "X-Forge-Password: <password>" http://localhost:3030/jobs/' + jobId + '/cancel');
  process.exit(1);
} else if (command === 'jobs') {
  const config = getConfig();
  initDatabase(config.dbPath);

  const jobs = listCIJobs(100);

  const runningJobs = jobs.filter((j) => j.status === 'running');
  const otherJobs = jobs.filter((j) => j.status !== 'running');

  if (runningJobs.length > 0) {
    console.log('RUNNING JOBS:');
    for (const job of runningJobs) {
      const cpu = getCPUUsage(job.id);
      const cpuStr = cpu !== null ? ` | CPU: ${cpu.toFixed(1)}%` : '';
      console.log(`  [${job.id}] ${job.repo}/${job.branch} @ ${job.headCommit.slice(0, 8)} | ${job.status}${cpuStr}`);
    }
    console.log('');
  }

  if (otherJobs.length > 0) {
    console.log('RECENT JOBS:');
    for (const job of otherJobs.slice(0, 20)) {
      const duration = job.finishedAt
        ? Math.round((job.finishedAt.getTime() - job.startedAt.getTime()) / 1000)
        : '?';
      console.log(`  [${job.id}] ${job.repo}/${job.branch} @ ${job.headCommit.slice(0, 8)} | ${job.status} | ${duration}s`);
    }
  }

  process.exit(0);
} else {
  console.log(`Command '${command}' not implemented. Use --help for usage.`);
  process.exit(1);
}
