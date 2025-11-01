import { htmlResponse, jsonResponse, jsonError } from './router';
import type { ForgeConfig, MergeRequest } from '../types';
import { listRepos, getRepoPath, createRepository, deleteRepository } from '../utils/repos';
import { listFeatureBranches, getHeadCommit } from '../git/branches';
import { getMergeMetadata, getDiff } from '../git/merge';
import { hasAutoMergeTrailer } from '../git/trailers';
import { getCIStatus, readCILog } from '../ci/status';
import { renderRepoList, renderCreateRepoForm, renderRepoCreated, renderDeleteConfirmation } from '../views/repos';
import { renderMRList, renderMRDetail } from '../views/merge-requests';
import { renderJobsDashboard, renderJobsScript, renderJobDetail } from '../views/jobs';
import { renderHistory } from '../views/history';
import { executeMerge } from '../git/merge-execute';
import { insertMergeHistory, insertCIJob, cancelPendingJobs, listCIJobs, getMergeHistory, getCIJob, getLatestCIJob } from '../db';
import { runPreMergeJob, runPostMergeJob, getCPUUsage, cancelJob } from '../ci/runner';
import { join } from 'path';
import { existsSync } from 'fs';

export function createHandlers(config: ForgeConfig) {
  return {
    getRoot: async (req: Request, params: Record<string, string>) => {
      const repos = listRepos(config.reposPath);
      return htmlResponse(renderRepoList(repos));
    },

    getCreate: async (req: Request, params: Record<string, string>) => {
      return htmlResponse(renderCreateRepoForm());
    },

    postCreate: async (req: Request, params: Record<string, string>) => {
      try {
        const formData = await req.formData();
        const name = formData.get('name') as string;
        const password = formData.get('password') as string;

        if (!password || password !== config.mergePassword) {
          return htmlResponse(renderCreateRepoForm('Invalid password'), 401);
        }

        const result = createRepository(config, name);

        if (!result.success) {
          return htmlResponse(renderCreateRepoForm(result.error), 400);
        }

        const cloneUrl = config.domain 
          ? `forge@${config.domain}:${name}.git`
          : `git@localhost:${name}.git`;
        const webUrl = `/r/${name}`;

        return htmlResponse(renderRepoCreated(name, cloneUrl, webUrl));
      } catch (error) {
        return htmlResponse(renderCreateRepoForm('Invalid request'), 400);
      }
    },

    getDeleteConfirm: async (req: Request, params: Record<string, string>) => {
      const { repo } = params;
      const repoPath = getRepoPath(config.reposPath, repo);
      const { existsSync } = await import('fs');
      
      if (!existsSync(repoPath)) {
        return htmlResponse('<h1>Repository not found</h1>', 404);
      }

      return htmlResponse(renderDeleteConfirmation(repo));
    },

    postDelete: async (req: Request, params: Record<string, string>) => {
      const { repo } = params;

      try {
        const formData = await req.formData();
        const confirm = formData.get('confirm') as string;
        const password = formData.get('password') as string;

        if (!password || password !== config.mergePassword) {
          return jsonError(401, 'Invalid password');
        }

        if (confirm !== repo) {
          return jsonError(400, 'Repository name does not match');
        }

        const result = deleteRepository(config, repo);

        if (!result.success) {
          return jsonError(400, result.error!);
        }

        return htmlResponse(`
          <!DOCTYPE html>
          <html>
            <head>
              <title>Repository Deleted</title>
              <meta http-equiv="refresh" content="2;url=/">
            </head>
            <body>
              <h2>✓ Repository deleted</h2>
              <p>Redirecting to home page...</p>
            </body>
          </html>
        `);
      } catch (error) {
        return jsonError(400, 'Invalid request');
      }
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

      const latestJob = getLatestCIJob(repo, branch, metadata.headCommit);
      const diff = getDiff(repoPath, metadata.mergeBase, metadata.headCommit);

      return htmlResponse(renderMRDetail(repo, mr, diff, latestJob));
    },

    getHistory: async (req: Request, params: Record<string, string>) => {
      const { repo } = params;
      const history = getMergeHistory(repo, 100);
      return htmlResponse(renderHistory(repo, history));
    },

    getCILog: async (req: Request, params: Record<string, string>) => {
      const { repo, commit } = params;
      const logPath = join(config.logsPath, repo, `${commit}.log`);

      if (!existsSync(logPath)) {
        return htmlResponse('<h1>Log not found</h1><p>The CI log has been pruned or does not exist.</p>', 404);
      }

      const logContent = readCILog(logPath);
      const { escapeHtml } = await import('../views/layout');
      
      return htmlResponse(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>CI Log - ${escapeHtml(commit.slice(0, 8))}</title>
            <style>
              body { font-family: monospace; padding: 20px; background: #1e1e1e; color: #d4d4d4; }
              pre { white-space: pre-wrap; word-wrap: break-word; }
              a { color: #4fc3f7; }
            </style>
          </head>
          <body>
            <div><a href="/r/${escapeHtml(repo)}/history">&larr; Back to history</a></div>
            <h2>CI Log for ${escapeHtml(commit.slice(0, 8))}</h2>
            <pre>${escapeHtml(logContent)}</pre>
          </body>
        </html>
      `);
    },

    getJobs: async (req: Request, params: Record<string, string>) => {
      const jobs = listCIJobs(100);
      
      const cpuUsages = new Map<number, number | null>();
      for (const job of jobs) {
        if (job.status === 'running') {
          cpuUsages.set(job.id, getCPUUsage(job.id));
        }
      }

      const html = renderJobsDashboard(jobs, cpuUsages);
      const withScript = html.replace('</body>', renderJobsScript() + '</body>');
      
      return htmlResponse(withScript);
    },

    getJobDetail: async (req: Request, params: Record<string, string>) => {
      const jobId = parseInt(params.jobId, 10);
      
      if (isNaN(jobId)) {
        return htmlResponse('<h1>Invalid job ID</h1>', 400);
      }

      const job = getCIJob(jobId);
      
      if (!job) {
        return htmlResponse('<h1>Job not found</h1>', 404);
      }

      let logContent: string | null = null;
      let logDeleted = false;

      if (existsSync(job.logPath)) {
        logContent = readCILog(job.logPath);
      } else {
        logDeleted = true;
      }

      const cpuUsage = job.status === 'running' ? getCPUUsage(job.id) : null;

      return htmlResponse(renderJobDetail(job, logContent, logDeleted, cpuUsage));
    },

    postCancelJob: async (req: Request, params: Record<string, string>) => {
      const jobId = parseInt(params.jobId, 10);
      const password = req.headers.get('X-Forge-Password');

      if (!password) {
        return jsonError(401, 'Password required');
      }

      if (password !== config.mergePassword) {
        return jsonError(401, 'Invalid password');
      }

      if (isNaN(jobId)) {
        return jsonError(400, 'Invalid job ID');
      }

      const success = cancelJob(jobId);

      if (!success) {
        return jsonError(404, 'Job not found or not running');
      }

      return jsonResponse({
        success: true,
        message: 'Job canceled',
      });
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

      // Trigger post-merge job (fire and forget)
      runPostMergeJob(config, repo, result.mergeCommit!).catch((err) => {
        console.error(`Failed to start post-merge job:`, err);
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
          // Trigger post-merge job for master branch updates
          const repoPath = getRepoPath(config.reposPath, repo);
          const headCommit = getHeadCommit(repoPath, 'master');
          
          if (headCommit) {
            runPostMergeJob(config, repo, headCommit).catch((err) => {
              console.error(`Failed to start post-merge job for ${repo}@${headCommit}:`, err);
            });
            return jsonResponse({ status: 'ok', message: 'Master branch updated, post-merge triggered' });
          }
          
          return jsonResponse({ status: 'ok', message: 'Master branch updated, no commit found' });
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

        runPreMergeJob(config, jobId, repo, branch, headCommit).catch((err) => {
          console.error(`Failed to run pre-merge job ${jobId}:`, err);
        });

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
