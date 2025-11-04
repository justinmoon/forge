import { layout, escapeHtml } from './layout';
import type { CIJob } from '../types';
import { seedJobLog } from '../realtime/log-stream';

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

  const restartButton = (job.status === 'failed' || job.status === 'canceled')
    ? `
      <button class="button" style="background: #17a2b8; padding: 5px 10px; font-size: 0.85em; margin-left: 5px;" onclick="restartJob(${job.id})">
        Restart
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
          ${restartButton}
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

  const cpuDisplay = cpuUsage !== null
    ? `<div class="stats">CPU Usage: ${cpuUsage.toFixed(1)}%</div>`
    : '';

  let logSection = '';
  const shouldStream = job.status === 'running';

  if (logDeleted) {
    logSection = `
      <div class="alert warning">
        <strong>Log deleted</strong>
        <p>This log file has been pruned or does not exist.</p>
      </div>
    `;
  } else if (logContent) {
    const logHtml = seedJobLog(job.id, logContent);
    logSection = `
      <h3>Build Log</h3>
      <div id="job-log-root" class="log-container">
        <pre id="job-log-pre">${logHtml}</pre>
      </div>
      ${shouldStream ? renderLogStreamScript(job.id) : ''}
    `;
  } else {
    seedJobLog(job.id, '');
    logSection = `
      <h3>Build Log</h3>
      <div id="job-log-root" class="log-container">
        <pre id="job-log-pre">&#8203;</pre>
      </div>
      ${shouldStream ? renderLogStreamScript(job.id) : ''}
    `;
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
    </div>

    ${logSection}
  `);
}

function renderLogStreamScript(jobId: number): string {
  const streamUrl = `/jobs/${jobId}/log-stream`;
  return `
    <script>
      (() => {
        const source = new EventSource('${streamUrl}');
        source.addEventListener('log', (event) => {
          try {
            const payload = JSON.parse(event.data);
            const target = document.querySelector('#job-log-pre');
            if (target) {
              target.innerHTML = payload.html || '\u200b';
            }
          } catch (_) {
            // Ignore malformed events; the stream will retry automatically.
          }
        });
      })();
    </script>
  `;
}

export function renderJobsScript(): string {
  return `
    <script>
      function cancelJob(jobId) {
        if (!confirm('Cancel job #' + jobId + '?')) return;

        fetch('/jobs/' + jobId + '/cancel', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          }
        })
        .then(res => res.json())
        .then(data => {
          if (data.error) {
            alert('Cancel failed: ' + data.error);
          } else {
            window.location.reload();
          }
        })
        .catch(err => {
          alert('Cancel failed: ' + err.message);
        });
      }

      function restartJob(jobId) {
        if (!confirm('Restart job #' + jobId + '?')) return;

        fetch('/jobs/' + jobId + '/restart', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          }
        })
        .then(res => res.json())
        .then(data => {
          if (data.error) {
            alert('Restart failed: ' + data.error);
          } else {
            alert('Job restarted as #' + data.newJobId);
            window.location.reload();
          }
        })
        .catch(err => {
          alert('Restart failed: ' + err.message);
        });
      }
    </script>
  `;
}
