import { parseDiff } from "../git/diff-parser";
import type { CIJob, MergeRequest } from "../types";
import { renderDiff } from "./diff";
import { renderDiffScripts } from "./diff-scripts";
import { escapeHtml, layout } from "./layout";

interface JobSummary {
	id: number;
	repo: string;
	branch: string;
	headCommit: string;
	status: string;
	exitCode: number | null;
	startedAt: string;
	finishedAt: string | null;
}

export function renderMRList(repo: string, mrs: MergeRequest[]): string {
	if (mrs.length === 0) {
		return layout(
			`${repo}`,
			`
      <h2><a href="/">&larr;</a> ${escapeHtml(repo)}</h2>
      <p>No active merge requests.</p>
      <p>
        <a href="/r/${escapeHtml(repo)}/history">View merge history</a> &nbsp;|&nbsp;
        <a href="/r/${escapeHtml(repo)}/delete" style="color: #c62828;">Delete repository</a>
      </p>
    `,
		);
	}

	const mrItems = mrs
		.map((mr) => {
			const ciStatusBadge = renderCIStatusBadge(mr.ciStatus);
			const conflictsBadge = mr.hasConflicts
				? '<span class="badge conflicts">conflicts</span>'
				: '<span class="badge clean">clean</span>';

			const branchSlug = encodeURIComponent(mr.branch);
			const branchKey = encodeURIComponent(mr.branch);
			const activeClass = mr.ciStatus === "running" ? " is-active" : "";
			return `
      <li data-branch="${branchKey}">
        <div class="mr-item${activeClass}" data-ci-item>
          <div class="mr-info">
            <h3><a href="/r/${escapeHtml(repo)}/mr/${branchSlug}">${escapeHtml(mr.branch)}</a></h3>
            <div class="stats">
              ${mr.aheadCount} commit${mr.aheadCount === 1 ? "" : "s"} ahead, 
              ${mr.behindCount} behind
            </div>
          </div>
          <div class="mr-status">
            <span data-ci-status>${ciStatusBadge}</span>
            ${conflictsBadge}
            ${mr.autoMerge ? '<span class="badge">auto-merge</span>' : ""}
          </div>
        </div>
      </li>
    `;
		})
		.join("");

	return layout(
		`${repo}`,
		`
    <h2><a href="/">&larr;</a> ${escapeHtml(repo)}</h2>
    <p>
      <a href="/r/${escapeHtml(repo)}/history">View merge history</a> &nbsp;|&nbsp;
      <a href="/r/${escapeHtml(repo)}/delete" style="color: #c62828;">Delete repository</a>
    </p>
    <h3>Active Merge Requests</h3>
    <ul class="mr-list" data-mr-list>
      ${mrItems}
    </ul>
  `,
	);
}

export function renderMRListScript(repo: string): string {
	const repoJson = JSON.stringify(repo);
	return `
    <script>
      (function() {
        const repo = ${repoJson};
        const list = document.querySelector('[data-mr-list]');
        if (!list) return;

        const renderBadge = (status) => {
          const labels = {
            pending: 'CI pending',
            running: 'CI running',
            passed: 'CI passed',
            failed: 'CI failed',
            timeout: 'CI timeout',
            canceled: 'CI canceled'
          };
          const classes = {
            pending: 'badge',
            running: 'badge running',
            passed: 'badge passed',
            failed: 'badge failed',
            timeout: 'badge timeout',
            canceled: 'badge'
          };
          const label = labels[status] || status;
          return '<span class="' + (classes[status] || 'badge') + '">' + label + '</span>';
        };

        const isActive = (status) => status === 'running' || status === 'pending';

        const applyUpdate = (job) => {
          if (job.repo !== repo) return;
          const key = encodeURIComponent(job.branch);
          const item = list.querySelector('[data-branch="' + key + '"]');
          if (!item) return;

          const statusEl = item.querySelector('[data-ci-status]');
          if (statusEl) {
            statusEl.innerHTML = renderBadge(job.status);
          }

          const container = item.querySelector('[data-ci-item]');
          if (container) {
            container.classList.toggle('is-active', isActive(job.status));
          }
        };

        window.addEventListener('forge:job-update', (event) => {
          const { type, payload } = event.detail;
          if (type === 'snapshot') {
            for (const job of payload) applyUpdate(job);
          } else {
            applyUpdate(payload);
          }
        });
      })();
    </script>
  `;
}

export function renderMRDetailScript(
	repo: string,
	branch: string,
	options: {
		autoMerge: boolean;
		hasConflicts: boolean;
		latestJob: JobSummary | null;
	},
): string {
	const repoJson = JSON.stringify(repo);
	const branchJson = JSON.stringify(branch);
	const autoMergeFlag = options.autoMerge ? "true" : "false";
	const conflictsFlag = options.hasConflicts ? "true" : "false";
	const latestJobJson = JSON.stringify(options.latestJob);
	const conflictAlert = JSON.stringify(
		options.hasConflicts
			? '<div class="alert warning"><strong>Merge conflicts detected</strong><p>This branch has conflicts with master. Resolve conflicts before merging.</p></div>'
			: "",
	);
	return `
    <script>
      (function() {
        const repo = ${repoJson};
        const branch = ${branchJson};
        const autoMerge = ${autoMergeFlag};
        const hasConflicts = ${conflictsFlag};
        const conflictAlert = ${conflictAlert};
        const initialJob = ${latestJobJson};

        const statusEl = document.querySelector('[data-ci-status]');
        const jobLinkEl = document.querySelector('[data-ci-job-link]');
        const mergeButtonEl = document.querySelector('[data-merge-button]');
        const alertContainer = document.querySelector('[data-ci-alert]');

        const renderBadge = (status) => {
          const labels = {
            pending: 'CI pending',
            running: 'CI running',
            passed: 'CI passed',
            failed: 'CI failed',
            timeout: 'CI timeout',
            canceled: 'CI canceled'
          };
          const classes = {
            pending: 'badge',
            running: 'badge running',
            passed: 'badge passed',
            failed: 'badge failed',
            timeout: 'badge timeout',
            canceled: 'badge'
          };
          const label = labels[status] || status;
          return '<span class="' + (classes[status] || 'badge') + '">' + label + '</span>';
        };

        const renderAlert = (status) => {
          if (status === 'running') {
            return '<div class="alert info"><strong>CI is running...</strong><p>Updates stream live on this page.</p></div>' + conflictAlert;
          }
          if (status === 'pending') {
            return '<div class="alert info"><strong>CI queued</strong><p>Job is waiting for runners.</p></div>' + conflictAlert;
          }
          if (status === 'failed') {
            return '<div class="alert warning"><strong>CI failed</strong><p>Review the logs to resolve issues before merging.</p></div>' + conflictAlert;
          }
          if (status === 'timeout') {
            return '<div class="alert warning"><strong>CI timed out</strong><p>The job exceeded the configured timeout limit. Review the logs and consider restarting.</p></div>' + conflictAlert;
          }
          if (status === 'canceled') {
            return '<div class="alert warning"><strong>CI canceled</strong><p>The most recent job was canceled.</p></div>' + conflictAlert;
          }
          if (status === 'passed') {
            if (autoMerge && !hasConflicts) {
              return '<div class="alert info"><strong>CI passed</strong><p>Auto-merge will finalize shortly.</p></div>' + conflictAlert;
            }
            return '<div class="alert info"><strong>CI passed</strong><p>All checks succeeded.</p></div>' + conflictAlert;
          }
          return conflictAlert;
        };

        const updateMergeButton = (status) => {
          if (!mergeButtonEl) return;
          if (status === 'passed' && !hasConflicts) {
            if (autoMerge) {
              mergeButtonEl.disabled = true;
              mergeButtonEl.textContent = 'Merge (auto-merge enabled)';
            } else {
              mergeButtonEl.disabled = false;
              mergeButtonEl.textContent = 'Merge to master';
            }
          } else {
            mergeButtonEl.disabled = true;
            mergeButtonEl.textContent = 'Merge (waiting for CI)';
          }
        };

        const updateJobLink = (job) => {
          if (!jobLinkEl) return;
          jobLinkEl.href = '/jobs/' + job.id;
          jobLinkEl.textContent = 'View CI logs (#' + job.id + ')';
          jobLinkEl.classList.remove('hidden');
        };

        let autoMergeNotified = false;

        const applyJob = (job) => {
          if (job.repo !== repo || job.branch !== branch) return;

          if (statusEl) {
            statusEl.innerHTML = renderBadge(job.status);
          }

          updateJobLink(job);
          updateMergeButton(job.status);

          if (alertContainer) {
            alertContainer.innerHTML = renderAlert(job.status);
          }

          if (autoMerge && job.status === 'passed' && !hasConflicts && !autoMergeNotified) {
            autoMergeNotified = true;
            setTimeout(() => window.location.reload(), 2000);
          }
        };

        if (initialJob) {
          applyJob(initialJob);
        }

        window.addEventListener('forge:job-update', (event) => {
          const { type, payload } = event.detail;
          if (type === 'snapshot') {
            for (const job of payload) applyJob(job);
          } else {
            applyJob(payload);
          }
        });
      })();
    </script>
  `;
}

export function renderMRDetail(
	repo: string,
	mr: MergeRequest,
	diff: string,
	latestJob: CIJob | null,
	previewUrl?: string | null,
): string {
	const ciStatusBadge = renderCIStatusBadge(mr.ciStatus);
	const conflictsBadge = mr.hasConflicts
		? '<span class="badge conflicts">conflicts</span>'
		: '<span class="badge clean">clean</span>';

	const mergeDisabled = mr.ciStatus !== "passed" || mr.hasConflicts;
	const mergeButton = mergeDisabled
		? `<button class="button" data-merge-button disabled>Merge (waiting for CI)</button>`
		: `<button class="button" data-merge-button onclick="handleMerge()">Merge to master</button>`;

	const jobLinkHref = latestJob ? `/jobs/${latestJob.id}` : "#";
	const jobLinkLabel = latestJob
		? `View CI logs (#${latestJob.id})`
		: "View CI logs";
	const jobLinkClass = latestJob ? "" : " hidden";
	const jobLink = `<a href="${jobLinkHref}" data-ci-job-link class="job-log-link${jobLinkClass}" style="margin-left: 15px;">${escapeHtml(jobLinkLabel)}</a>`;

	let ciAlert = "";
	if (mr.ciStatus === "not-configured") {
		ciAlert = `
      <div class="alert warning">
        <strong>CI not configured</strong>
        <p>This repository does not expose a <code>pre-merge</code> command for Forge to run.</p>
        <p>Add a <code>pre-merge</code> recipe to your <code>justfile</code> or expose <code>.#pre-merge</code> in <code>flake.nix</code>, then push a commit to enable merging.</p>
      </div>
    `;
	} else if (mr.ciStatus === "running") {
		ciAlert = `
      <div class="alert info">
        <strong>CI is running...</strong>
        <p>Refresh the page to see updated status.</p>
      </div>
    `;
	} else if (mr.hasConflicts) {
		ciAlert = `
      <div class="alert warning">
        <strong>Merge conflicts detected</strong>
        <p>This branch has conflicts with master. Resolve conflicts before merging.</p>
      </div>
    `;
	}

	const diffPreview = diff
		? `
    <h3>Changes</h3>
    ${renderDiff(parseDiff(diff))}
  `
		: "<p>No changes to display.</p>";

	return layout(
		`${repo} / ${mr.branch}`,
		`
    <h2><a href="/r/${escapeHtml(repo)}">&larr;</a> ${escapeHtml(repo)} / ${escapeHtml(mr.branch)}</h2>
    
    <div class="stats">
      <strong>Head commit:</strong> <code>${escapeHtml(mr.headCommit.slice(0, 8))}</code> &nbsp;|&nbsp;
      <strong>Merge base:</strong> <code>${escapeHtml(mr.mergeBase.slice(0, 8))}</code> &nbsp;|&nbsp;
      ${mr.aheadCount} ahead, ${mr.behindCount} behind
    </div>

    <div style="margin: 20px 0;" data-ci-summary>
      <strong>CI Status:</strong> <span data-ci-status>${ciStatusBadge}</span> &nbsp;
      <strong>Conflicts:</strong> <span data-ci-conflicts>${conflictsBadge}</span>
      ${mr.autoMerge ? '<span class="badge" data-auto-merge>auto-merge enabled</span>' : ""}
      ${jobLink}
    </div>

    <div data-ci-alert>
      ${ciAlert}
    </div>

    ${
			previewUrl
				? `
    <div style="margin: 20px 0;">
      <strong>Preview Deployment</strong>
      <p>This branch has a preview deployment available:</p>
      <p><a href="${escapeHtml(previewUrl)}" target="_blank" style="font-weight: bold; font-size: 16px;">${escapeHtml(previewUrl)}</a></p>
    </div>
    `
				: ""
		}

    <div style="margin: 20px 0;">
      ${mergeButton}
      <button class="button" onclick="handleDeleteBranch()" style="background: #dc3545; margin-left: 10px;">Delete Branch</button>
    </div>

    ${diffPreview}

    ${renderDiffScripts()}

    <script>
      function handleMerge() {
        fetch(window.location.pathname + '/merge', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          }
        })
        .then(res => res.json())
        .then(data => {
          if (data.error) {
            alert('Merge failed: ' + data.error);
          } else {
            alert('Merge successful!');
            window.location.href = '/r/${escapeHtml(repo)}';
          }
        })
        .catch(err => {
          alert('Merge failed: ' + err.message);
        });
      }

      function handleDeleteBranch() {
        if (!confirm('Are you sure you want to delete this branch? This cannot be undone.')) {
          return;
        }

        fetch(window.location.pathname + '/delete', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          }
        })
        .then(res => res.json())
        .then(data => {
          if (data.error) {
            alert('Delete failed: ' + data.error);
          } else {
            alert('Branch deleted successfully!');
            window.location.href = '/r/${escapeHtml(repo)}';
          }
        })
        .catch(err => {
          alert('Delete failed: ' + err.message);
        });
      }
    </script>
  `,
	);
}

function renderCIStatusBadge(status: string): string {
	const badges: Record<string, string> = {
		"not-configured":
			'<span class="badge not-configured">CI not configured</span>',
		running: '<span class="badge running">CI running</span>',
		passed: '<span class="badge passed">CI passed</span>',
		failed: '<span class="badge failed">CI failed</span>',
		unknown: '<span class="badge">CI unknown</span>',
	};
	return badges[status] || badges.unknown;
}
