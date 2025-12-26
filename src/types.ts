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
  // New field for tracking merge request creation time
  createdAt?: Date;
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
  status: 'pending' | 'running' | 'passed' | 'failed' | 'timeout' | 'canceled';
  logPath: string;
  startedAt: Date;
  finishedAt: Date | null;
  exitCode: number | null;
  // Track duration for analytics
  duration?: number;
}

export interface PostReceivePayload {
  repo: string;
  ref: string;
  oldrev: string;
  newrev: string;
  deleted?: boolean;
}

export interface ContainerConfig {
  enabled: boolean;
  image: string;
  network: string;
  tmpfsSize: string;
  keepWorkdir: boolean;
}

export interface ForgeConfig {
  dataDir: string;
  port: number;
  allowedPubkeys: string[];
  reposPath: string;
  logsPath: string;
  dbPath: string;
  workPath: string;
  domain?: string;
  isDevelopment: boolean;
  trustProxy: boolean; // Trust X-Forwarded-For header (only enable behind trusted reverse proxy)
  jobTimeout: number; // CI job timeout in seconds (default: 3600 = 1 hour)
  jobTimeoutCheckInterval: number; // How often to check for timeouts in ms (default: 30000 = 30 seconds)
  container: ContainerConfig;
}
