import { describe, test, expect, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { MIGRATIONS } from '../src/db/schema';
import {
  initDatabase,
  insertMergeHistory,
  getMergeHistory,
  insertCIJob,
  updateCIJob,
  getCIJob,
  listCIJobs,
  getLatestCIJob,
  cancelPendingJobs,
} from '../src/db';

describe('Database migrations', () => {
  let db: Database;

  beforeEach(() => {
    db = initDatabase(':memory:');
  });

  test('migrations table is created', () => {
    const result = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='migrations'").get();
    expect(result).toBeTruthy();
  });

  test('migrations are applied', () => {
    const migrations = db.query('SELECT version, name FROM migrations ORDER BY version').all();
    expect(migrations.length).toBeGreaterThan(0);
    expect(migrations[0]).toHaveProperty('version', 1);
    expect(migrations[0]).toHaveProperty('name', 'initial_schema');
  });

  test('merge_history table exists with correct columns', () => {
    const columns = db.query("PRAGMA table_info(merge_history)").all() as any[];
    const columnNames = columns.map((col) => col.name);

    expect(columnNames).toContain('id');
    expect(columnNames).toContain('repo');
    expect(columnNames).toContain('branch');
    expect(columnNames).toContain('head_commit');
    expect(columnNames).toContain('merge_commit');
    expect(columnNames).toContain('merged_at');
    expect(columnNames).toContain('ci_status');
    expect(columnNames).toContain('ci_log_path');
  });

  test('ci_jobs table exists with correct columns', () => {
    const columns = db.query("PRAGMA table_info(ci_jobs)").all() as any[];
    const columnNames = columns.map((col) => col.name);

    expect(columnNames).toContain('id');
    expect(columnNames).toContain('repo');
    expect(columnNames).toContain('branch');
    expect(columnNames).toContain('head_commit');
    expect(columnNames).toContain('status');
    expect(columnNames).toContain('log_path');
    expect(columnNames).toContain('started_at');
    expect(columnNames).toContain('finished_at');
    expect(columnNames).toContain('exit_code');
  });

  test('ci_jobs indexes are created', () => {
    const indexes = db.query("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='ci_jobs'").all() as any[];
    const indexNames = indexes.map((idx) => idx.name);

    expect(indexNames).toContain('idx_ci_jobs_status');
    expect(indexNames).toContain('idx_ci_jobs_repo_branch');
  });
});

describe('Merge history operations', () => {
  let db: Database;

  beforeEach(() => {
    db = initDatabase(':memory:');
  });

  test('insertMergeHistory adds a record', () => {
    insertMergeHistory({
      repo: 'test-repo',
      branch: 'feature-1',
      headCommit: 'abc123',
      mergeCommit: 'def456',
      mergedAt: new Date('2025-01-01T12:00:00Z'),
      ciStatus: 'passed',
      ciLogPath: '/logs/test.log',
    });

    const history = getMergeHistory('test-repo');
    expect(history.length).toBe(1);
    expect(history[0].repo).toBe('test-repo');
    expect(history[0].branch).toBe('feature-1');
    expect(history[0].headCommit).toBe('abc123');
    expect(history[0].mergeCommit).toBe('def456');
    expect(history[0].ciStatus).toBe('passed');
  });

  test('getMergeHistory returns records ordered by merged_at DESC', () => {
    insertMergeHistory({
      repo: 'test-repo',
      branch: 'feature-1',
      headCommit: 'abc123',
      mergeCommit: 'def456',
      mergedAt: new Date('2025-01-01T12:00:00Z'),
      ciStatus: 'passed',
      ciLogPath: null,
    });

    insertMergeHistory({
      repo: 'test-repo',
      branch: 'feature-2',
      headCommit: 'ghi789',
      mergeCommit: 'jkl012',
      mergedAt: new Date('2025-01-02T12:00:00Z'),
      ciStatus: 'passed',
      ciLogPath: null,
    });

    const history = getMergeHistory('test-repo');
    expect(history.length).toBe(2);
    expect(history[0].branch).toBe('feature-2');
    expect(history[1].branch).toBe('feature-1');
  });

  test('getMergeHistory respects limit', () => {
    for (let i = 0; i < 5; i++) {
      insertMergeHistory({
        repo: 'test-repo',
        branch: `feature-${i}`,
        headCommit: `commit-${i}`,
        mergeCommit: `merge-${i}`,
        mergedAt: new Date(`2025-01-0${i + 1}T12:00:00Z`),
        ciStatus: 'passed',
        ciLogPath: null,
      });
    }

    const history = getMergeHistory('test-repo', 3);
    expect(history.length).toBe(3);
  });
});

describe('CI job operations', () => {
  let db: Database;

  beforeEach(() => {
    db = initDatabase(':memory:');
  });

  test('insertCIJob adds a record and returns ID', () => {
    const jobId = insertCIJob({
      repo: 'test-repo',
      branch: 'feature-1',
      headCommit: 'abc123',
      status: 'pending',
      logPath: '/logs/job-1.log',
      startedAt: new Date('2025-01-01T12:00:00Z'),
    });

    expect(jobId).toBeGreaterThan(0);

    const job = getCIJob(jobId);
    expect(job).toBeTruthy();
    expect(job?.repo).toBe('test-repo');
    expect(job?.status).toBe('pending');
  });

  test('updateCIJob updates status and finished_at', () => {
    const jobId = insertCIJob({
      repo: 'test-repo',
      branch: 'feature-1',
      headCommit: 'abc123',
      status: 'running',
      logPath: '/logs/job-1.log',
      startedAt: new Date('2025-01-01T12:00:00Z'),
    });

    updateCIJob(jobId, {
      status: 'passed',
      finishedAt: new Date('2025-01-01T12:05:00Z'),
      exitCode: 0,
    });

    const job = getCIJob(jobId);
    expect(job?.status).toBe('passed');
    expect(job?.finishedAt).toEqual(new Date('2025-01-01T12:05:00Z'));
    expect(job?.exitCode).toBe(0);
  });

  test('listCIJobs returns jobs with running first', () => {
    insertCIJob({
      repo: 'test-repo',
      branch: 'feature-1',
      headCommit: 'abc123',
      status: 'passed',
      logPath: '/logs/job-1.log',
      startedAt: new Date('2025-01-01T12:00:00Z'),
    });

    insertCIJob({
      repo: 'test-repo',
      branch: 'feature-2',
      headCommit: 'def456',
      status: 'running',
      logPath: '/logs/job-2.log',
      startedAt: new Date('2025-01-01T12:01:00Z'),
    });

    const jobs = listCIJobs();
    expect(jobs.length).toBe(2);
    expect(jobs[0].status).toBe('running');
    expect(jobs[1].status).toBe('passed');
  });

  test('getLatestCIJob returns most recent job for branch', () => {
    const job1Id = insertCIJob({
      repo: 'test-repo',
      branch: 'feature-1',
      headCommit: 'abc123',
      status: 'passed',
      logPath: '/logs/job-1.log',
      startedAt: new Date('2025-01-01T12:00:00Z'),
    });

    const job2Id = insertCIJob({
      repo: 'test-repo',
      branch: 'feature-1',
      headCommit: 'abc123',
      status: 'running',
      logPath: '/logs/job-2.log',
      startedAt: new Date('2025-01-01T12:05:00Z'),
    });

    const latestJob = getLatestCIJob('test-repo', 'feature-1', 'abc123');
    expect(latestJob?.id).toBe(job2Id);
    expect(latestJob?.status).toBe('running');
  });

  test('cancelPendingJobs cancels pending jobs for branch', () => {
    const job1Id = insertCIJob({
      repo: 'test-repo',
      branch: 'feature-1',
      headCommit: 'abc123',
      status: 'pending',
      logPath: '/logs/job-1.log',
      startedAt: new Date('2025-01-01T12:00:00Z'),
    });

    const job2Id = insertCIJob({
      repo: 'test-repo',
      branch: 'feature-1',
      headCommit: 'def456',
      status: 'pending',
      logPath: '/logs/job-2.log',
      startedAt: new Date('2025-01-01T12:01:00Z'),
    });

    cancelPendingJobs('test-repo', 'feature-1', job2Id);

    const job1 = getCIJob(job1Id);
    const job2 = getCIJob(job2Id);

    expect(job1?.status).toBe('canceled');
    expect(job2?.status).toBe('pending');
  });
});
