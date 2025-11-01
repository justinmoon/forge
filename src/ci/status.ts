import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { CIStatus } from '../types';
import { getLatestCIJob } from '../db';

export function getCIStatus(
  logsPath: string,
  repo: string,
  branch: string,
  headCommit: string
): CIStatus {
  const job = getLatestCIJob(repo, branch, headCommit);
  
  if (job) {
    if (job.status === 'running' || job.status === 'pending') {
      return 'running';
    }
    if (job.status === 'passed') {
      return 'passed';
    }
    if (job.status === 'failed' || job.status === 'canceled') {
      return 'failed';
    }
  }

  const statusPath = join(logsPath, repo, `${headCommit}.status`);
  if (existsSync(statusPath)) {
    try {
      const statusContent = readFileSync(statusPath, 'utf-8');
      const status = JSON.parse(statusContent);
      
      if (status.status === 'passed') return 'passed';
      if (status.status === 'failed') return 'failed';
      if (status.status === 'running') return 'running';
    } catch (err) {
      return 'unknown';
    }
  }

  return 'not-configured';
}

export function getCILogPath(logsPath: string, repo: string, headCommit: string): string | null {
  const logPath = join(logsPath, repo, `${headCommit}.log`);
  return existsSync(logPath) ? logPath : null;
}

export function readCILog(logPath: string): string {
  try {
    return readFileSync(logPath, 'utf-8');
  } catch (err) {
    return 'Log file not found or could not be read.';
  }
}
