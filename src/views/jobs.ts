import { layout, escapeHtml } from './layout';
import type { CIJob } from '../types';

export function renderJobsDashboard(
  jobs: CIJob[],
  cpuUsages: Map<number, number | null>
): string {
  const runningJobs = jobs.filter((j) => j.status === 'running');
  const historicalJobs = jobs.filter((j) => j.status !== 'running');

  const runningSection = runningJobs.length > 0
    ? `
    <h3>Running Jobs</h3>
    <ul class="mr-list">
      ${runningJobs.map((job) => renderJobItem(job, cpuUsages.get(job.id) || null, true)).join('')}
    </ul>
  `
    : '<p>No jobs currently running.</p>';

  const historicalSection = historicalJobs.length > 0
    ? `
    <h3>Recent Jobs (Latest 100)</h3>
    <ul class="mr-list">
      ${historicalJobs.map((job) => renderJobItem(job, null, false)).join('')}
    </ul>
  `
    : '';

  return layout('CI Jobs', `
    <h2>CI Jobs</h2>
    ${runningSection}
    ${historicalSection}
  `);
}

function renderJobItem(job: CIJob, cpuUsage: number | null, showCancel: boolean): string {
  const statusBadge = getStatusBadge(job.status);
  const duration = job.finishedAt
    ? Math.round((job.finishedAt.getTime() - job.startedAt.getTime()) / 1000)
    : Math.round((Date.now() - job.startedAt.getTime()) / 1000);

  const cpuDisplay = cpuUsage !== null
    ? `<span class="stats">CPU: ${cpuUsage.toFixed(1)}%</span>`
    : '';

  const cancelButton = showCancel
    ? `
      <button class="button" style="background: #dc3545; padding: 5px 10px; font-size: 0.85em;" onclick="cancelJob(${job.id})">
        Cancel
      </button>
    `
    : '';

  return `
    <li>
      <div class="mr-item">
        <div class="mr-info">
          <h3>
            <a href="/jobs/${job.id}">
              Job #${job.id}: ${escapeHtml(job.repo)}/${escapeHtml(job.branch)}
            </a>
          </h3>
          <div class="stats">
            Commit: <code>${escapeHtml(job.headCommit.slice(0, 8))}</code> &nbsp;|&nbsp;
            Duration: ${duration}s
            ${job.exitCode !== null ? ` &nbsp;|&nbsp; Exit: ${job.exitCode}` : ''}
          </div>
          ${cpuDisplay}
        </div>
        <div class="mr-status">
          ${statusBadge}
          ${cancelButton}
        </div>
      </div>
    </li>
  `;
}

function getStatusBadge(status: string): string {
  const badges: Record<string, string> = {
    'pending': '<span class="badge">pending</span>',
    'running': '<span class="badge running">running</span>',
    'passed': '<span class="badge passed">passed</span>',
    'failed': '<span class="badge failed">failed</span>',
    'canceled': '<span class="badge">canceled</span>',
  };
  return badges[status] || '<span class="badge">unknown</span>';
}

export function renderJobDetail(
  job: CIJob,
  logContent: string | null,
  logDeleted: boolean,
  cpuUsage: number | null
): string {
  const statusBadge = getStatusBadge(job.status);
  const duration = job.finishedAt
    ? Math.round((job.finishedAt.getTime() - job.startedAt.getTime()) / 1000)
    : Math.round((Date.now() - job.startedAt.getTime()) / 1000);

  const refreshButton = job.status === 'running'
    ? `<button class="button" onclick="window.location.reload()" style="background: #28a745; margin-left: 10px;">Refresh</button>`
    : '';

  const cpuDisplay = cpuUsage !== null
    ? `<div class="stats">CPU Usage: ${cpuUsage.toFixed(1)}%</div>`
    : '';

  let logSection = '';
  if (logDeleted) {
    logSection = `
      <div class="alert warning">
        <strong>Log deleted</strong>
        <p>This log file has been pruned or does not exist.</p>
      </div>
    `;
  } else if (logContent) {
    logSection = `
      <h3>Build Log</h3>
      <div class="log-container">
        <pre id="log-output"></pre>
      </div>
      <script src="https://cdn.jsdelivr.net/npm/ansi_up@6.0.2/ansi_up.min.js"></script>
      <script>
        const ansi_up = new AnsiUp();
        const logText = ${JSON.stringify(logContent)};
        const html = ansi_up.ansi_to_html(logText);
        document.getElementById('log-output').innerHTML = html;
      </script>
    `;
  } else {
    logSection = '<p>No log content available.</p>';
  }

  return layout(`Job #${job.id}`, `
    <h2><a href="/jobs">&larr;</a> Job #${job.id}</h2>
    
    <div style="background: #f9f9f9; border: 1px solid #e0e0e0; border-radius: 5px; padding: 15px; margin: 20px 0;">
      <div style="margin-bottom: 10px;">
        <strong>Repository:</strong> <a href="/r/${escapeHtml(job.repo)}">${escapeHtml(job.repo)}</a> / 
        <a href="/r/${escapeHtml(job.repo)}/mr/${escapeHtml(job.branch)}">${escapeHtml(job.branch)}</a>
      </div>
      <div style="margin-bottom: 10px;">
        <strong>Commit:</strong> <code>${escapeHtml(job.headCommit)}</code>
      </div>
      <div style="margin-bottom: 10px;">
        <strong>Status:</strong> ${statusBadge}
        ${job.exitCode !== null ? ` <strong>Exit Code:</strong> ${job.exitCode}` : ''}
      </div>
      <div style="margin-bottom: 10px;">
        <strong>Started:</strong> ${job.startedAt.toLocaleString()}
        ${job.finishedAt ? ` &nbsp;|&nbsp; <strong>Finished:</strong> ${job.finishedAt.toLocaleString()}` : ''}
      </div>
      <div style="margin-bottom: 10px;">
        <strong>Duration:</strong> ${duration}s
      </div>
      ${cpuDisplay}
    </div>

    <div style="margin: 20px 0;">
      <a href="/jobs" class="button">Back to Jobs</a>
      ${refreshButton}
    </div>

    ${logSection}
  `);
}

export function renderJobsScript(): string {
  return `
    <script>
      function cancelJob(jobId) {
        const password = prompt('Enter password to cancel job:');
        if (!password) return;

        fetch('/jobs/' + jobId + '/cancel', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Forge-Password': password
          }
        })
        .then(res => res.json())
        .then(data => {
          if (data.error) {
            alert('Cancel failed: ' + data.error);
          } else {
            alert('Job canceled successfully');
            window.location.reload();
          }
        })
        .catch(err => {
          alert('Cancel failed: ' + err.message);
        });
      }
    </script>
  `;
}
