import { execGit, execGitOrThrow, GitError } from './exec';
import { getMergeMetadata, checkConflicts } from './merge';
import { branchExists } from './branches';

export interface MergeResult {
  success: boolean;
  mergeCommit?: string;
  error?: string;
}

export function executeMerge(
  repoPath: string,
  branch: string,
  baseBranch: string = 'master'
): MergeResult {
  if (!branchExists(repoPath, branch)) {
    return { success: false, error: 'Branch does not exist' };
  }

  if (!branchExists(repoPath, baseBranch)) {
    return { success: false, error: 'Base branch does not exist' };
  }

  const metadata = getMergeMetadata(repoPath, branch, baseBranch);
  if (!metadata) {
    return { success: false, error: 'Could not get merge metadata' };
  }

  if (metadata.hasConflicts) {
    return { success: false, error: 'Branch has conflicts with master' };
  }

  try {
    const mergeTreeResult = execGit(
      ['merge-tree', '--write-tree', baseBranch, branch],
      { cwd: repoPath }
    );

    if (!mergeTreeResult.success) {
      return { success: false, error: 'Merge tree failed: ' + mergeTreeResult.stderr };
    }

    const treeOid = mergeTreeResult.stdout.trim();

    const baseCommit = execGitOrThrow(['rev-parse', baseBranch], { cwd: repoPath }).trim();
    const branchCommit = execGitOrThrow(['rev-parse', branch], { cwd: repoPath }).trim();

    const commitMessage = `Forge Merge: ${branch}\n\nForge-Branch: ${branch}\nForge-Head: ${branchCommit}\nForge-Merge: true`;

    const commitResult = execGit(
      ['commit-tree', treeOid, '-p', baseCommit, '-p', branchCommit, '-m', commitMessage],
      { cwd: repoPath }
    );

    if (!commitResult.success) {
      return { success: false, error: 'Commit tree failed: ' + commitResult.stderr };
    }

    const mergeCommit = commitResult.stdout.trim();

    const updateRefResult = execGit(
      ['update-ref', `refs/heads/${baseBranch}`, mergeCommit],
      { cwd: repoPath }
    );

    if (!updateRefResult.success) {
      return { success: false, error: 'Update ref failed: ' + updateRefResult.stderr };
    }

    const deleteRefResult = execGit(
      ['update-ref', '-d', `refs/heads/${branch}`],
      { cwd: repoPath }
    );

    if (!deleteRefResult.success) {
      return { success: false, error: 'Delete branch failed: ' + deleteRefResult.stderr };
    }

    return { success: true, mergeCommit };
  } catch (error) {
    if (error instanceof GitError) {
      return { success: false, error: error.message };
    }
    return { success: false, error: String(error) };
  }
}
