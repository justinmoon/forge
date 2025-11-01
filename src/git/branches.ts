import { execGit, execGitOrThrow } from './exec';

export function listBranches(repoPath: string): string[] {
  const result = execGit(['for-each-ref', '--format=%(refname:short)', 'refs/heads/'], {
    cwd: repoPath,
  });

  if (!result.success) {
    console.error(`Failed to list branches in ${repoPath}:`, result.stderr, `(exit ${result.exitCode})`);
    return [];
  }

  return result.stdout
    .trim()
    .split('\n')
    .filter((line) => line.length > 0);
}

export function listFeatureBranches(repoPath: string): string[] {
  const branches = listBranches(repoPath);
  return branches.filter((branch) => branch !== 'master');
}

export function getHeadCommit(repoPath: string, ref: string): string | null {
  const result = execGit(['rev-parse', ref], { cwd: repoPath });
  if (!result.success) {
    return null;
  }
  return result.stdout.trim();
}

export function branchExists(repoPath: string, branch: string): boolean {
  const result = execGit(['rev-parse', '--verify', `refs/heads/${branch}`], {
    cwd: repoPath,
  });
  return result.success;
}
