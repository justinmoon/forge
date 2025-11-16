import { seedJobLog } from "../realtime/log-stream";
import type { CIJob } from "../types";
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

export function renderJobsDashboard(
	jobs: CIJob[],
	cpuUsages: Map<number, number | null>,
): string {
	const runningJobs = jobs.filter(
		(j) => j.status === "running" || j.status === "pending",
	);
	const historicalJobs = jobs.filter(
		(j) => j.status !== "running" && j.status !== "pending",
	);

	const runningSection = `
	<section data-running-section>
	  <h3>Running Jobs</h3>
	  <p class="jobs-empty${runningJobs.length ? " hidden" : ""}" data-running-empty>No jobs currently active.</p>
	  <ul class="mr-list" data-job-list="running">
	    ${runningJobs
				.map((job) => renderJobItem(job, cpuUsages.get(job.id) || null, true))
				.join("")}
	  </ul>
	</section>`;

	const historicalSection = `
	<section data-history-section class="${historicalJobs.length ? "" : "hidden"}">
	  <h3>Recent Jobs (Latest 100)</h3>
	  <ul class="mr-list" data-job-list="history">
	    ${historicalJobs.map((job) => renderJobItem(job, null, false)).join("")}
	  </ul>
	</section>`;

	return layout(
		"CI Jobs",
		`
    <h2>CI Jobs</h2>
    ${runningSection}
    ${historicalSection}
  `,
	);
}

function renderJobItem(
	job: CIJob,
	cpuUsage: number | null,
	showCancel: boolean,
): string {
	const statusBadge = getStatusBadge(job.status);
	const duration = job.finishedAt
		? Math.round((job.finishedAt.getTime() - job.startedAt.getTime()) / 1000)
		: Math.round((Date.now() - job.startedAt.getTime()) / 1000);

	const cpuDisplay =
		cpuUsage !== null
			? `<span class="stats">CPU: ${cpuUsage.toFixed(1)}%</span>`
			: "";

	const cancelButton = showCancel
		? `
      <button class="button" style="background: #dc3545; padding: 5px 10px; font-size: 0.85em;" onclick="cancelJob(${job.id})">
        Cancel
      </button>
    `
		: "";

	const restartButton =
		job.status === "failed" ||
		job.status === "canceled" ||
		job.status === "timeout"
			? `
      <button class="button" style="background: #17a2b8; padding: 5px 10px; font-size: 0.85em; margin-left: 5px;" onclick="restartJob(${job.id})">
        Restart
      </button>
    `
			: "";

	return `
    <li
      data-job-id="${job.id}"
      data-job-status="${job.status}"
      data-job-repo="${escapeHtml(job.repo)}"
      data-job-branch="${escapeHtml(job.branch)}"
      data-job-head="${escapeHtml(job.headCommit)}"
      data-job-started="${job.startedAt.toISOString()}"
      ${job.finishedAt ? `data-job-finished="${job.finishedAt.toISOString()}"` : ""}
      ${job.exitCode !== null && job.exitCode !== undefined ? `data-job-exit="${job.exitCode}"` : ""}
    >
      <div class="mr-item${job.status === "running" || job.status === "pending" ? " is-active" : ""}">
        <div class="mr-info">
          <h3>
            <a href="/jobs/${job.id}">
              Job #${job.id}: ${escapeHtml(job.repo)}/${escapeHtml(job.branch)}
            </a>
          </h3>
          <div class="stats">
            Commit: <code>${escapeHtml(job.headCommit.slice(0, 8))}</code> &nbsp;|&nbsp;
            Duration: ${duration}s
            ${job.exitCode !== null ? ` &nbsp;|&nbsp; Exit: ${job.exitCode}` : ""}
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
		pending: '<span class="badge">pending</span>',
		running: '<span class="badge running">running</span>',
		passed: '<span class="badge passed">passed</span>',
		failed: '<span class="badge failed">failed</span>',
		timeout: '<span class="badge timeout">timeout</span>',
		canceled: '<span class="badge">canceled</span>',
	};
	return badges[status] || '<span class="badge">unknown</span>';
}

export function renderJobDetail(
	job: CIJob,
	logContent: string | null,
	logDeleted: boolean,
	cpuUsage: number | null,
): string {
	const statusBadge = getStatusBadge(job.status);
	const duration = job.finishedAt
		? Math.round((job.finishedAt.getTime() - job.startedAt.getTime()) / 1000)
		: Math.round((Date.now() - job.startedAt.getTime()) / 1000);

	const cpuDisplay =
		cpuUsage !== null
			? `<div class="stats">CPU Usage: ${cpuUsage.toFixed(1)}%</div>`
			: "";

	let logSection = "";
	const shouldStream = job.status === "running";

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
      ${shouldStream ? renderLogStreamScript(job.id) : ""}
    `;
	} else {
		seedJobLog(job.id, "");
		logSection = `
      <h3>Build Log</h3>
      <div id="job-log-root" class="log-container">
        <pre id="job-log-pre">&#8203;</pre>
      </div>
      ${shouldStream ? renderLogStreamScript(job.id) : ""}
    `;
	}

	return layout(
		`Job #${job.id}`,
		`
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
        ${job.exitCode !== null ? ` <strong>Exit Code:</strong> ${job.exitCode}` : ""}
      </div>
      <div style="margin-bottom: 10px;">
        <strong>Started:</strong> ${job.startedAt.toLocaleString()}
        ${job.finishedAt ? ` &nbsp;|&nbsp; <strong>Finished:</strong> ${job.finishedAt.toLocaleString()}` : ""}
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
  `,
	);
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

export function renderJobsScript(initialJobs: JobSummary[]): string {
	const jobsJson = JSON.stringify(initialJobs);
	return `
    <script>
      const FORGE_INITIAL_JOBS = ${jobsJson};
      const jobState = new Map(FORGE_INITIAL_JOBS.map((job) => [job.id, job]));

      const runningList = document.querySelector('[data-job-list="running"]');
      const runningEmpty = document.querySelector('[data-running-empty]');
      const historyList = document.querySelector('[data-job-list="history"]');
      const historySection = document.querySelector('[data-history-section]');

      const isActiveStatus = (status) => status === 'running' || status === 'pending';

      const escapeHtml = (value) => String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');

      const renderBadge = (status) => {
        const labels = {
          pending: 'Pending',
          running: 'Running',
          passed: 'Passed',
          failed: 'Failed',
          timeout: 'Timeout',
          canceled: 'Canceled'
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

      const formatDuration = (job) => {
        const start = Number(new Date(job.startedAt));
        const end = job.finishedAt ? Number(new Date(job.finishedAt)) : Date.now();
        const seconds = Math.max(1, Math.round((end - start) / 1000));
        return seconds + 's';
      };

      const renderJobItem = (job) => {
        const status = job.status;
        const exitInfo = job.exitCode !== null && job.exitCode !== undefined
          ? ' &nbsp;|&nbsp; Exit: ' + job.exitCode
          : '';
        const cancelButton = status === 'running'
          ? '<button class="button" style="background: #dc3545; padding: 5px 10px; font-size: 0.85em;" onclick="cancelJob(' + job.id + ')">Cancel</button>'
          : '';
        const restartButton = status === 'failed' || status === 'canceled' || status === 'timeout'
          ? '<button class="button" style="background: #17a2b8; padding: 5px 10px; font-size: 0.85em; margin-left: 5px;" onclick="restartJob(' + job.id + ')">Restart</button>'
          : '';

        return (
          '<li data-job-id="' + job.id + '" data-job-status="' + status + '">' +
            '<div class="mr-item' + (isActiveStatus(status) ? ' is-active' : '') + '">' +
              '<div class="mr-info">' +
                '<h3><a href="/jobs/' + job.id + '">Job #' + job.id + ': ' + escapeHtml(job.repo) + '/' + escapeHtml(job.branch) + '</a></h3>' +
                '<div class="stats">Commit: <code>' + escapeHtml(job.headCommit.slice(0, 8)) + '</code> &nbsp;|&nbsp; Duration: ' + formatDuration(job) + exitInfo + '</div>' +
              '</div>' +
              '<div class="mr-status">' +
                renderBadge(status) +
                cancelButton +
                restartButton +
              '</div>' +
            '</div>' +
          '</li>'
        );
      };

      function renderJobLists() {
        if (!runningList || !historyList) return;

        const jobs = Array.from(jobState.values());
        const running = jobs
          .filter((job) => isActiveStatus(job.status))
          .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
        const historical = jobs
          .filter((job) => !isActiveStatus(job.status))
          .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));

        runningList.innerHTML = running.map(renderJobItem).join('');
        if (runningEmpty) {
          runningEmpty.classList.toggle('hidden', running.length > 0);
        }

        historyList.innerHTML = historical.map(renderJobItem).join('');
        if (historySection) {
          historySection.classList.toggle('hidden', historical.length === 0);
        }
      }

      const trimHistory = () => {
        if (jobState.size <= 200) return;
        const entries = Array.from(jobState.values())
          .filter((job) => !isActiveStatus(job.status))
          .sort((a, b) => new Date(a.startedAt) - new Date(b.startedAt));
        while (entries.length && jobState.size > 200) {
          const oldest = entries.shift();
          if (oldest) {
            jobState.delete(oldest.id);
          }
        }
      };

      window.addEventListener('forge:job-update', (event) => {
        const { type, payload } = event.detail;
        if (type === 'snapshot') {
          for (const job of payload) {
            jobState.set(job.id, job);
          }
        } else if (type === 'job') {
          jobState.set(payload.id, payload);
        }
        trimHistory();
        renderJobLists();
      });

      setInterval(renderJobLists, 15000);

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

      renderJobLists();
    </script>
  `;
}
