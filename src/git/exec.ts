import { spawnSync } from 'child_process';

export interface GitResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}

export function execGit(
  args: string[],
  options: { cwd?: string; env?: Record<string, string> } = {}
): GitResult {
  // Always trust repos in the data directory to avoid git safe.directory issues
  const dataDir = process.env.FORGE_DATA_DIR || '/var/lib/forge';
  const fullArgs = ['-c', `safe.directory=${dataDir}/repos/*`, ...args];
  
  const result = spawnSync('git', fullArgs, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    encoding: 'utf-8',
    maxBuffer: 10 * 1024 * 1024,
  });

  return {
    success: result.status === 0,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    exitCode: result.status || 1,
  };
}

export class GitError extends Error {
  constructor(
    message: string,
    public readonly stderr: string,
    public readonly exitCode: number
  ) {
    super(message);
    this.name = 'GitError';
  }
}

export function execGitOrThrow(
  args: string[],
  options: { cwd?: string; env?: Record<string, string> } = {}
): string {
  const result = execGit(args, options);
  if (!result.success) {
    throw new GitError(
      `Git command failed: git ${args.join(' ')}`,
      result.stderr,
      result.exitCode
    );
  }
  return result.stdout;
}
