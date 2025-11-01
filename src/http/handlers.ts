import { htmlResponse, jsonResponse, jsonError } from './router';
import type { ForgeConfig, MergeRequest } from '../types';
import { listRepos, getRepoPath } from '../utils/repos';
import { listFeatureBranches, getHeadCommit } from '../git/branches';
import { getMergeMetadata, getDiff } from '../git/merge';
import { hasAutoMergeTrailer } from '../git/trailers';
import { getCIStatus } from '../ci/status';
import { renderRepoList } from '../views/repos';
import { renderMRList, renderMRDetail } from '../views/merge-requests';
import { executeMerge } from '../git/merge-execute';
import { insertMergeHistory, insertCIJob, cancelPendingJobs } from '../db';
import { join } from 'path';

export function createHandlers(config: ForgeConfig) {
  return {
    getRoot: async (req: Request, params: Record<string, string>) => {
      const repos = listRepos(config.reposPath);
      return htmlResponse(renderRepoList(repos));
    },

    getRepo: async (req: Request, params: Record<string, string>) => {
      const { repo } = params;
      const repoPath = getRepoPath(config.reposPath, repo);
      const branches = listFeatureBranches(repoPath);

      const mrs: MergeRequest[] = [];
      for (const branch of branches) {
        const metadata = getMergeMetadata(repoPath, branch);
        if (metadata) {
          const ciStatus = getCIStatus(
            config.logsPath,
            repo,
            branch,
            metadata.headCommit
          );
          const autoMerge = hasAutoMergeTrailer(repoPath, metadata.headCommit);

          mrs.push({
            repo,
            branch,
            headCommit: metadata.headCommit,
            mergeBase: metadata.mergeBase,
            aheadCount: metadata.aheadCount,
            behindCount: metadata.behindCount,
            hasConflicts: metadata.hasConflicts,
            ciStatus,
            autoMerge,
          });
        }
      }

      return htmlResponse(renderMRList(repo, mrs));
    },

    getMergeRequest: async (req: Request, params: Record<string, string>) => {
      const { repo, branch } = params;
      const repoPath = getRepoPath(config.reposPath, repo);
      
      const metadata = getMergeMetadata(repoPath, branch);
      if (!metadata) {
        return htmlResponse('<h1>Branch not found</h1>', 404);
      }

      const ciStatus = getCIStatus(
        config.logsPath,
        repo,
        branch,
        metadata.headCommit
      );
      const autoMerge = hasAutoMergeTrailer(repoPath, metadata.headCommit);

      const mr: MergeRequest = {
        repo,
        branch,
        headCommit: metadata.headCommit,
        mergeBase: metadata.mergeBase,
        aheadCount: metadata.aheadCount,
        behindCount: metadata.behindCount,
        hasConflicts: metadata.hasConflicts,
        ciStatus,
        autoMerge,
      };

      const diff = getDiff(repoPath, metadata.mergeBase, metadata.headCommit);

      return htmlResponse(renderMRDetail(repo, mr, diff));
    },

    getHistory: async (req: Request, params: Record<string, string>) => {
      const { repo } = params;
      return htmlResponse(`
        <!DOCTYPE html>
        <html>
          <head><title>${repo} history - forge</title></head>
          <body>
            <h1>${repo} history</h1>
            <p>Placeholder: Merged requests history</p>
          </body>
        </html>
      `);
    },

    getJobs: async (req: Request, params: Record<string, string>) => {
      return htmlResponse(`
        <!DOCTYPE html>
        <html>
          <head><title>CI Jobs - forge</title></head>
          <body>
            <h1>CI Jobs</h1>
            <p>Placeholder: Running and historical jobs</p>
          </body>
        </html>
      `);
    },

    postMerge: async (req: Request, params: Record<string, string>) => {
      const { repo, branch } = params;
      const password = req.headers.get('X-Forge-Password');

      if (!password) {
        return jsonError(401, 'Password required');
      }

      if (password !== config.mergePassword) {
        return jsonError(401, 'Invalid password');
      }

      const repoPath = getRepoPath(config.reposPath, repo);
      
      const metadata = getMergeMetadata(repoPath, branch);
      if (!metadata) {
        return jsonError(404, 'Branch not found');
      }

      const ciStatus = getCIStatus(
        config.logsPath,
        repo,
        branch,
        metadata.headCommit
      );

      if (ciStatus !== 'passed') {
        return jsonError(400, 'CI must pass before merging');
      }

      if (metadata.hasConflicts) {
        return jsonError(400, 'Branch has conflicts with master');
      }

      const result = executeMerge(repoPath, branch);

      if (!result.success) {
        return jsonError(500, result.error || 'Merge failed');
      }

      insertMergeHistory({
        repo,
        branch,
        headCommit: metadata.headCommit,
        mergeCommit: result.mergeCommit!,
        mergedAt: new Date(),
        ciStatus,
        ciLogPath: null,
      });

      return jsonResponse({
        success: true,
        mergeCommit: result.mergeCommit,
        message: 'Merge successful',
      });
    },

    postReceive: async (req: Request, params: Record<string, string>) => {
      try {
        const payload = await req.json() as any;
        const { repo, ref, oldrev, newrev, deleted } = payload;

        console.log('Post-receive hook:', { repo, ref, oldrev, newrev, deleted });

        if (!repo || !ref) {
          return jsonError(400, 'Missing required fields: repo, ref');
        }

        const branch = ref.replace('refs/heads/', '');
        
        if (branch === 'master') {
          return jsonResponse({ status: 'ok', message: 'Master branch updated, no action' });
        }

        if (deleted) {
          cancelPendingJobs(repo, branch);
          return jsonResponse({ status: 'ok', message: 'Branch deleted, jobs canceled' });
        }

        const repoPath = getRepoPath(config.reposPath, repo);
        const headCommit = getHeadCommit(repoPath, branch);
        
        if (!headCommit) {
          return jsonResponse({ status: 'ok', message: 'Branch not found' });
        }

        cancelPendingJobs(repo, branch);

        const logPath = join(config.logsPath, repo, `${headCommit}.log`);
        
        const jobId = insertCIJob({
          repo,
          branch,
          headCommit,
          status: 'pending',
          logPath,
          startedAt: new Date(),
        });

        const autoMerge = hasAutoMergeTrailer(repoPath, headCommit);

        return jsonResponse({
          status: 'ok',
          message: 'CI job created',
          jobId,
          autoMerge,
        });
      } catch (error) {
        console.error('Post-receive error:', error);
        return jsonError(400, 'Invalid request: ' + String(error));
      }
    },
  };
}
