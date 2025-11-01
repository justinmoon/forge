import { getRepoPath } from '../utils/repos';
import { hasAutoMergeTrailer } from '../git/trailers';
import { branchExists } from '../git/branches';
import { getMergeMetadata } from '../git/merge';
import { executeMerge } from '../git/merge-execute';
import { insertMergeHistory } from '../db';
import { runPostMergeJob } from './runner';
import type { ForgeConfig } from '../types';

export function tryAutoMerge(
  config: ForgeConfig,
  repo: string,
  branch: string,
  headCommit: string,
  ciStatus: string
): { attempted: boolean; success: boolean; error?: string } {
  if (ciStatus !== 'passed') {
    return { attempted: false, success: false, error: 'CI not passed' };
  }

  const repoPath = getRepoPath(config.reposPath, repo);

  if (!hasAutoMergeTrailer(repoPath, headCommit)) {
    return { attempted: false, success: false, error: 'No auto-merge trailer' };
  }

  if (!branchExists(repoPath, branch)) {
    return { attempted: false, success: false, error: 'Branch no longer exists' };
  }

  const metadata = getMergeMetadata(repoPath, branch);
  if (!metadata) {
    return { attempted: true, success: false, error: 'Could not get merge metadata' };
  }

  if (metadata.hasConflicts) {
    return { attempted: true, success: false, error: 'Branch has conflicts' };
  }

  console.log(`Auto-merging ${repo}/${branch}...`);

  const result = executeMerge(repoPath, branch);

  if (!result.success) {
    return { attempted: true, success: false, error: result.error };
  }

  insertMergeHistory({
    repo,
    branch,
    headCommit,
    mergeCommit: result.mergeCommit!,
    mergedAt: new Date(),
    ciStatus,
    ciLogPath: null,
  });

  console.log(`Auto-merge successful: ${result.mergeCommit}`);

  // Trigger post-merge job (fire and forget)
  runPostMergeJob(config, repo, result.mergeCommit!).catch((err) => {
    console.error(`Failed to start post-merge job after auto-merge:`, err);
  });

  return { attempted: true, success: true };
}
