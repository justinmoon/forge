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
            <a href="/r/${escapeHtml(job.repo)}/mr/${escapeHtml(job.branch)}">
              ${escapeHtml(job.repo)}/${escapeHtml(job.branch)}
            </a>
          </h3>
          <div class="stats">
            Job #${job.id} &nbsp;|&nbsp;
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
