import { execGit, execGitOrThrow } from './exec';

export interface MergeMetadata {
  headCommit: string;
  mergeBase: string;
  aheadCount: number;
  behindCount: number;
  hasConflicts: boolean;
}

export function getMergeBase(
  repoPath: string,
  branch1: string,
  branch2: string
): string | null {
  const result = execGit(['merge-base', branch1, branch2], { cwd: repoPath });
  if (!result.success) {
    return null;
  }
  return result.stdout.trim();
}

export function getAheadBehindCounts(
  repoPath: string,
  branch: string,
  base: string
): { ahead: number; behind: number } {
  const result = execGit(
    ['rev-list', '--left-right', '--count', `${branch}...${base}`],
    { cwd: repoPath }
  );

  if (!result.success) {
    return { ahead: 0, behind: 0 };
  }

  const parts = result.stdout.trim().split(/\s+/);
  return {
    ahead: parseInt(parts[0] || '0', 10),
    behind: parseInt(parts[1] || '0', 10),
  };
}

export function checkConflicts(
  repoPath: string,
  base: string,
  branch: string
): boolean {
  const result = execGit(['merge-tree', '--write-tree', base, branch], {
    cwd: repoPath,
  });
  return !result.success;
}

export function getDiff(
  repoPath: string,
  base: string,
  head: string
): string {
  const result = execGit(['diff', '--no-color', `${base}..${head}`], {
    cwd: repoPath,
  });
  return result.stdout;
}

export function getMergeMetadata(
  repoPath: string,
  branch: string,
  baseBranch: string = 'master'
): MergeMetadata | null {
  const headCommit = execGit(['rev-parse', branch], { cwd: repoPath });
  if (!headCommit.success) {
    return null;
  }

  const mergeBase = getMergeBase(repoPath, branch, baseBranch);
  if (!mergeBase) {
    return null;
  }

  const counts = getAheadBehindCounts(repoPath, branch, baseBranch);
  const hasConflicts = checkConflicts(repoPath, baseBranch, branch);

  return {
    headCommit: headCommit.stdout.trim(),
    mergeBase,
    aheadCount: counts.ahead,
    behindCount: counts.behind,
    hasConflicts,
  };
}
