import { layout, escapeHtml } from './layout';
import type { MergeRequest, CIJob } from '../types';
import { parseDiff } from '../git/diff-parser';
import { renderDiff } from './diff';
import { renderDiffScripts } from './diff-scripts';

export function renderMRList(repo: string, mrs: MergeRequest[]): string {
  if (mrs.length === 0) {
    return layout(`${repo}`, `
      <h2><a href="/">&larr;</a> ${escapeHtml(repo)}</h2>
      <p>No active merge requests.</p>
      <p>
        <a href="/r/${escapeHtml(repo)}/history">View merge history</a> &nbsp;|&nbsp;
        <a href="/r/${escapeHtml(repo)}/delete" style="color: #c62828;">Delete repository</a>
      </p>
    `);
  }

  const mrItems = mrs
    .map((mr) => {
      const ciStatusBadge = renderCIStatusBadge(mr.ciStatus);
      const conflictsBadge = mr.hasConflicts
        ? '<span class="badge conflicts">conflicts</span>'
        : '<span class="badge clean">clean</span>';
      
      return `
      <li>
        <div class="mr-item">
          <div class="mr-info">
            <h3><a href="/r/${escapeHtml(repo)}/mr/${escapeHtml(mr.branch)}">${escapeHtml(mr.branch)}</a></h3>
            <div class="stats">
              ${mr.aheadCount} commit${mr.aheadCount === 1 ? '' : 's'} ahead, 
              ${mr.behindCount} behind
            </div>
          </div>
          <div class="mr-status">
            ${ciStatusBadge}
            ${conflictsBadge}
            ${mr.autoMerge ? '<span class="badge">auto-merge</span>' : ''}
          </div>
        </div>
      </li>
    `;
    })
    .join('');

  return layout(`${repo}`, `
    <h2><a href="/">&larr;</a> ${escapeHtml(repo)}</h2>
    <p>
      <a href="/r/${escapeHtml(repo)}/history">View merge history</a> &nbsp;|&nbsp;
      <a href="/r/${escapeHtml(repo)}/delete" style="color: #c62828;">Delete repository</a>
    </p>
    <h3>Active Merge Requests</h3>
    <ul class="mr-list">
      ${mrItems}
    </ul>
  `);
}

export function renderMRDetail(repo: string, mr: MergeRequest, diff: string, latestJob: CIJob | null, previewUrl?: string | null): string {
  const ciStatusBadge = renderCIStatusBadge(mr.ciStatus);
  const conflictsBadge = mr.hasConflicts
    ? '<span class="badge conflicts">conflicts</span>'
    : '<span class="badge clean">clean</span>';

  const mergeDisabled = mr.ciStatus !== 'passed' || mr.hasConflicts;
  const mergeButton = mergeDisabled
    ? `<button class="button" disabled>Merge (waiting for CI)</button>`
    : `<button class="button" onclick="handleMerge()">Merge to master</button>`;

  const jobLink = latestJob
    ? `<a href="/jobs/${latestJob.id}" style="margin-left: 15px;">View CI logs</a>`
    : '';

  let ciAlert = '';
  if (mr.ciStatus === 'not-configured') {
    ciAlert = `
      <div class="alert warning">
        <strong>CI not configured</strong>
        <p>This repository does not have CI configured. To enable merging:</p>
        <ul>
          <li>Add <code>.github/workflows/*.yml</code>, or</li>
          <li>Expose <code>.#ci</code> in your <code>flake.nix</code></li>
        </ul>
        <p>Merging is disabled until CI is configured and passes.</p>
      </div>
    `;
  } else if (mr.ciStatus === 'running') {
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
    : '<p>No changes to display.</p>';

  return layout(`${repo} / ${mr.branch}`, `
    <h2><a href="/r/${escapeHtml(repo)}">&larr;</a> ${escapeHtml(repo)} / ${escapeHtml(mr.branch)}</h2>
    
    <div class="stats">
      <strong>Head commit:</strong> <code>${escapeHtml(mr.headCommit.slice(0, 8))}</code> &nbsp;|&nbsp;
      <strong>Merge base:</strong> <code>${escapeHtml(mr.mergeBase.slice(0, 8))}</code> &nbsp;|&nbsp;
      ${mr.aheadCount} ahead, ${mr.behindCount} behind
    </div>

    <div style="margin: 20px 0;">
      <strong>CI Status:</strong> ${ciStatusBadge} &nbsp;
      <strong>Conflicts:</strong> ${conflictsBadge}
      ${mr.autoMerge ? '<span class="badge">auto-merge enabled</span>' : ''}
      ${jobLink}
    </div>

    ${ciAlert}

    ${previewUrl ? `
    <div style="margin: 20px 0;">
      <strong>Preview Deployment</strong>
      <p>This branch has a preview deployment available:</p>
      <p><a href="${escapeHtml(previewUrl)}" target="_blank" style="font-weight: bold; font-size: 16px;">${escapeHtml(previewUrl)}</a></p>
    </div>
    ` : ''}

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
  `);
}

function renderCIStatusBadge(status: string): string {
  const badges: Record<string, string> = {
    'not-configured': '<span class="badge not-configured">CI not configured</span>',
    'running': '<span class="badge running">CI running</span>',
    'passed': '<span class="badge passed">CI passed</span>',
    'failed': '<span class="badge failed">CI failed</span>',
    'unknown': '<span class="badge">CI unknown</span>',
  };
  return badges[status] || badges['unknown'];
}
