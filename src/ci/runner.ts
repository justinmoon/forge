import { spawn } from 'child_process';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { execGit } from '../git/exec';
import { updateCIJob, getCIJob, insertCIJob } from '../db';
import { tryAutoMerge } from './auto-merge';
import type { ForgeConfig } from '../types';

export interface RunningJob {
  jobId: number;
  process: any;
  startTime: number;
}

const runningJobs = new Map<number, RunningJob>();

export function isJobRunning(jobId: number): boolean {
  return runningJobs.has(jobId);
}

export function getRunningJob(jobId: number): RunningJob | undefined {
  return runningJobs.get(jobId);
}

export function cancelJob(jobId: number): boolean {
  const job = runningJobs.get(jobId);
  if (!job) {
    return false;
  }

  try {
    job.process.kill('SIGTERM');
    runningJobs.delete(jobId);
    
    updateCIJob(jobId, {
      status: 'canceled',
      finishedAt: new Date(),
    });

    return true;
  } catch (error) {
    console.error(`Failed to cancel job ${jobId}:`, error);
    return false;
  }
}

export async function runPreMergeJob(
  config: ForgeConfig,
  jobId: number,
  repo: string,
  branch: string,
  headCommit: string
): Promise<void> {
  console.log(`Starting pre-merge job ${jobId} for ${repo}/${branch}@${headCommit}`);

  const repoPath = join(config.reposPath, `${repo}.git`);
  const worktreePath = join(config.workPath, repo, String(jobId));
  const logDir = join(config.logsPath, repo);
  const logPath = join(logDir, `${headCommit}.log`);
  const statusPath = join(logDir, `${headCommit}.status`);

  try {
    mkdirSync(logDir, { recursive: true });
    mkdirSync(worktreePath, { recursive: true });

    const worktreeResult = execGit(
      ['worktree', 'add', '--force', '--detach', worktreePath, headCommit],
      { cwd: repoPath }
    );

    if (!worktreeResult.success) {
      throw new Error(`Failed to create worktree: ${worktreeResult.stderr}`);
    }

    updateCIJob(jobId, { status: 'running' });

    const logStream = require('fs').createWriteStream(logPath, { flags: 'w' });
    
    const startTime = Date.now();

    // Run nix run .#pre-merge
    const ciProcess = spawn('nix', ['run', '.#pre-merge'], {
      cwd: worktreePath,
      env: { ...process.env },
    });

    runningJobs.set(jobId, {
      jobId,
      process: ciProcess,
      startTime,
    });

    ciProcess.stdout?.on('data', (data) => {
      logStream.write(data);
    });

    ciProcess.stderr?.on('data', (data) => {
      logStream.write(data);
    });

    const exitCode = await new Promise<number>((resolve) => {
      ciProcess.on('close', (code) => {
        resolve(code ?? 1);
      });
      ciProcess.on('error', (err) => {
        logStream.write(`\nProcess error: ${err.message}\n`);
        resolve(1);
      });
    });

    logStream.end();
    runningJobs.delete(jobId);

    const finishedAt = new Date();
    const status = exitCode === 0 ? 'passed' : 'failed';

    updateCIJob(jobId, {
      status,
      finishedAt,
      exitCode,
    });

    const statusData = {
      status,
      exitCode,
      startedAt: new Date(startTime).toISOString(),
      finishedAt: finishedAt.toISOString(),
      jobId,
    };

    try {
      mkdirSync(logDir, { recursive: true });
      writeFileSync(statusPath, JSON.stringify(statusData, null, 2));
    } catch (writeErr) {
      console.error(`Failed to write status file:`, writeErr);
    }

    console.log(`Pre-merge job ${jobId} completed with status: ${status} (exit ${exitCode})`);

    if (status === 'passed') {
      const autoMergeResult = tryAutoMerge(config, repo, branch, headCommit, status);
      if (autoMergeResult.attempted) {
        if (autoMergeResult.success) {
          console.log(`Auto-merge successful for ${repo}/${branch}`);
        } else {
          console.log(`Auto-merge failed for ${repo}/${branch}: ${autoMergeResult.error}`);
        }
      } else {
        console.log(`Auto-merge not attempted for ${repo}/${branch}: ${autoMergeResult.error}`);
      }
    }
  } catch (error) {
    console.error(`CI job ${jobId} error:`, error);
    
    runningJobs.delete(jobId);
    
    updateCIJob(jobId, {
      status: 'failed',
      finishedAt: new Date(),
      exitCode: 1,
    });

    const errorMessage = error instanceof Error ? error.message : String(error);
    
    try {
      mkdirSync(logDir, { recursive: true });
      writeFileSync(logPath, `CI job failed: ${errorMessage}\n`);
      
      const statusData = {
        status: 'failed',
        exitCode: 1,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        jobId,
        error: errorMessage,
      };
      writeFileSync(statusPath, JSON.stringify(statusData, null, 2));
    } catch (writeErr) {
      console.error(`Failed to write log/status files:`, writeErr);
    }
  } finally {
    if (existsSync(worktreePath)) {
      try {
        execGit(['worktree', 'remove', worktreePath], { cwd: repoPath });
      } catch (err) {
        console.error(`Failed to remove worktree ${worktreePath}:`, err);
        try {
          rmSync(worktreePath, { recursive: true, force: true });
        } catch (cleanupErr) {
          console.error(`Failed to cleanup worktree directory:`, cleanupErr);
        }
      }
    }
  }
}

export function getCPUUsage(jobId: number): number | null {
  const job = runningJobs.get(jobId);
  if (!job || !job.process || !job.process.pid) {
    return null;
  }

  try {
    const { execSync } = require('child_process');
    const output = execSync(`ps -p ${job.process.pid} -o %cpu | tail -n 1`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    const cpu = parseFloat(output.trim());
    return isNaN(cpu) ? null : cpu;
  } catch (error) {
    return null;
  }
}

export async function runPostMergeJob(
  config: ForgeConfig,
  repo: string,
  mergeCommit: string
): Promise<void> {
  console.log(`Starting post-merge job for ${repo}@${mergeCommit}`);

  const jobId = insertCIJob({
    repo,
    branch: 'master',
    headCommit: mergeCommit,
    status: 'pending',
    logPath: join(config.logsPath, repo, `${mergeCommit}-post-merge.log`),
    startedAt: new Date(),
  });

  const repoPath = join(config.reposPath, `${repo}.git`);
  const worktreePath = join(config.workPath, repo, `post-merge-${jobId}`);
  const logPath = join(config.logsPath, repo, `${mergeCommit}-post-merge.log`);

  try {
    mkdirSync(join(config.logsPath, repo), { recursive: true });
    mkdirSync(worktreePath, { recursive: true });

    const worktreeResult = execGit(
      ['worktree', 'add', '--force', '--detach', worktreePath, mergeCommit],
      { cwd: repoPath }
    );

    if (!worktreeResult.success) {
      throw new Error(`Failed to create worktree: ${worktreeResult.stderr}`);
    }

    updateCIJob(jobId, { status: 'running' });

    const logStream = require('fs').createWriteStream(logPath, { flags: 'w' });
    const startTime = Date.now();

    // Run nix run .#post-merge
    const postMergeProcess = spawn('nix', ['run', '.#post-merge'], {
      cwd: worktreePath,
      env: { ...process.env },
    });

    runningJobs.set(jobId, {
      jobId,
      process: postMergeProcess,
      startTime,
    });

    postMergeProcess.stdout?.on('data', (data) => {
      logStream.write(data);
    });

    postMergeProcess.stderr?.on('data', (data) => {
      logStream.write(data);
    });

    const exitCode = await new Promise<number>((resolve) => {
      postMergeProcess.on('close', (code) => {
        resolve(code ?? 1);
      });
      postMergeProcess.on('error', (err) => {
        logStream.write(`\nProcess error: ${err.message}\n`);
        resolve(1);
      });
    });

    logStream.end();
    runningJobs.delete(jobId);

    const finishedAt = new Date();
    const status = exitCode === 0 ? 'passed' : 'failed';

    updateCIJob(jobId, {
      status,
      finishedAt,
      exitCode,
    });

    const statusData = {
      status,
      exitCode,
      startedAt: new Date(startTime).toISOString(),
      finishedAt: finishedAt.toISOString(),
    };

    writeFileSync(
      join(config.logsPath, repo, `${mergeCommit}-post-merge.status`),
      JSON.stringify(statusData, null, 2)
    );

    console.log(`Post-merge job ${jobId} completed: ${status} (exit ${exitCode})`);

  } catch (error) {
    console.error(`Post-merge job ${jobId} failed:`, error);
    updateCIJob(jobId, {
      status: 'failed',
      finishedAt: new Date(),
      exitCode: 1,
    });
  } finally {
    try {
      execGit(['worktree', 'remove', '--force', worktreePath], {
        cwd: repoPath,
      });
    } catch (err) {
      console.error('Failed to remove worktree:', err);
    }
  }
}
