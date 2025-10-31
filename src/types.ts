export interface MergeRequest {
  repo: string;
  branch: string;
  headCommit: string;
  mergeBase: string;
  aheadCount: number;
  behindCount: number;
  hasConflicts: boolean;
  ciStatus: CIStatus;
  autoMerge: boolean;
}

export type CIStatus = 'not-configured' | 'running' | 'passed' | 'failed' | 'unknown';

export interface MergeHistoryEntry {
  id: number;
  repo: string;
  branch: string;
  headCommit: string;
  mergeCommit: string;
  mergedAt: Date;
  ciStatus: string;
  ciLogPath: string | null;
}

export interface CIJob {
  id: number;
  repo: string;
  branch: string;
  headCommit: string;
  status: 'pending' | 'running' | 'passed' | 'failed' | 'canceled';
  logPath: string;
  startedAt: Date;
  finishedAt: Date | null;
  exitCode: number | null;
}

export interface PostReceivePayload {
  repo: string;
  ref: string;
  oldrev: string;
  newrev: string;
  deleted?: boolean;
}

export interface ForgeConfig {
  dataDir: string;
  port: number;
  mergePassword: string;
  reposPath: string;
  logsPath: string;
  dbPath: string;
  workPath: string;
}
