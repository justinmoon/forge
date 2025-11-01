import { layout, escapeHtml } from './layout';
import type { MergeHistoryEntry } from '../types';

export function renderHistory(repo: string, history: MergeHistoryEntry[]): string {
  if (history.length === 0) {
    return layout(`${repo} history`, `
      <h2><a href="/r/${escapeHtml(repo)}">&larr;</a> ${escapeHtml(repo)} / History</h2>
      <p>No merge history yet.</p>
    `);
  }

  const historyItems = history.map((entry) => renderHistoryItem(repo, entry)).join('');

  return layout(`${repo} history`, `
    <h2><a href="/r/${escapeHtml(repo)}">&larr;</a> ${escapeHtml(repo)} / History</h2>
    <h3>Merged Requests</h3>
    <ul class="mr-list">
      ${historyItems}
    </ul>
  `);
}

function renderHistoryItem(repo: string, entry: MergeHistoryEntry): string {
  const ciStatusBadge = getCIStatusBadge(entry.ciStatus);
  const timestamp = entry.mergedAt.toLocaleString();
  
  const logLink = entry.ciLogPath
    ? `<a href="/r/${escapeHtml(repo)}/logs/${escapeHtml(entry.headCommit)}" style="margin-left: 10px;">View CI log</a>`
    : '';

  return `
    <li>
      <div class="mr-item">
        <div class="mr-info">
          <h3>
            ${escapeHtml(entry.branch)}
          </h3>
          <div class="stats">
            Merged at: ${escapeHtml(timestamp)} &nbsp;|&nbsp;
            Merge commit: <code>${escapeHtml(entry.mergeCommit.slice(0, 8))}</code> &nbsp;|&nbsp;
            Head: <code>${escapeHtml(entry.headCommit.slice(0, 8))}</code>
          </div>
        </div>
        <div class="mr-status">
          ${ciStatusBadge}
          ${logLink}
        </div>
      </div>
    </li>
  `;
}

function getCIStatusBadge(status: string): string {
  const badges: Record<string, string> = {
    'not-configured': '<span class="badge not-configured">CI not configured</span>',
    'running': '<span class="badge running">CI running</span>',
    'passed': '<span class="badge passed">CI passed</span>',
    'failed': '<span class="badge failed">CI failed</span>',
    'unknown': '<span class="badge">CI unknown</span>',
  };
  return badges[status] || badges['unknown'];
}
