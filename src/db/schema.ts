export const MIGRATIONS = [
  {
    version: 1,
    name: 'initial_schema',
    up: `
      CREATE TABLE IF NOT EXISTS migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS merge_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        repo TEXT NOT NULL,
        branch TEXT NOT NULL,
        head_commit TEXT NOT NULL,
        merge_commit TEXT NOT NULL,
        merged_at DATETIME NOT NULL,
        ci_status TEXT NOT NULL,
        ci_log_path TEXT,
        UNIQUE(repo, merge_commit)
      );

      CREATE TABLE IF NOT EXISTS ci_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        repo TEXT NOT NULL,
        branch TEXT NOT NULL,
        head_commit TEXT NOT NULL,
        status TEXT NOT NULL,
        log_path TEXT NOT NULL,
        started_at DATETIME NOT NULL,
        finished_at DATETIME,
        exit_code INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_ci_jobs_status ON ci_jobs(status);
      CREATE INDEX IF NOT EXISTS idx_ci_jobs_repo_branch ON ci_jobs(repo, branch, head_commit);
    `,
  },
  {
    version: 2,
    name: 'add_sessions_table',
    up: `
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        pubkey TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        last_accessed INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_pubkey ON sessions(pubkey);
      CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
    `,
  },
];
