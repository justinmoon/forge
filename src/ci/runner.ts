import {
	type ChildProcess,
	execSync,
	spawn,
	spawnSync,
} from "node:child_process";
import {
	createWriteStream,
	existsSync,
	mkdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { getCIJob, insertCIJob, updateCIJob } from "../db";
import { execGit } from "../git/exec";
import {
	appendJobLogChunk,
	completeJobLog,
	seedJobLog,
} from "../realtime/log-stream";
import type { ForgeConfig } from "../types";
import { tryAutoMerge } from "./auto-merge";

export interface RunningJob {
	jobId: number;
	process: ChildProcess;
	startTime: number;
}

const runningJobs = new Map<number, RunningJob>();
let timeoutMonitorInterval: NodeJS.Timeout | null = null;

function resolveNixSystem(): string {
	const archMap: Record<string, string> = {
		arm64: "aarch64",
		aarch64: "aarch64",
		x64: "x86_64",
		ia32: "i686",
	};
	const platformMap: Record<string, string> = {
		darwin: "darwin",
		linux: "linux",
	};

	const arch = archMap[process.arch] ?? process.arch;
	const platform = platformMap[process.platform] ?? process.platform;
	return `${arch}-${platform}`;
}

function flakeAppExists(worktreePath: string, app: string): boolean {
	const system = resolveNixSystem();
	const attr = `.#apps.${system}.${app}`;
	const result = spawnSync("nix", ["eval", "--json", attr], {
		cwd: worktreePath,
		encoding: "utf-8",
		stdio: ["ignore", "pipe", "ignore"],
	});

	return result.status === 0;
}

export function isJobRunning(jobId: number): boolean {
	return runningJobs.has(jobId);
}

export function getRunningJob(jobId: number): RunningJob | undefined {
	return runningJobs.get(jobId);
}

export function cancelJob(jobId: number, reason: string = "canceled"): boolean {
	const job = runningJobs.get(jobId);

	// If job is not in memory, check if it exists in DB as "running"
	if (!job) {
		const dbJob = getCIJob(jobId);
		if (dbJob && dbJob.status === "running") {
			// Stuck job - mark as canceled in DB
			updateCIJob(jobId, {
				status: reason,
				finishedAt: new Date(),
				exitCode: reason === "timeout" ? 124 : 143, // 124 for timeout, 143 for SIGTERM
			});
			console.log(`${reason === "timeout" ? "Timed out" : "Canceled"} stuck job ${jobId} (no running process found)`);
			return true;
		}
		return false;
	}

	try {
		job.process.kill("SIGTERM");
		runningJobs.delete(jobId);

		updateCIJob(jobId, {
			status: reason,
			finishedAt: new Date(),
			exitCode: reason === "timeout" ? 124 : 143,
		});

		console.log(`${reason === "timeout" ? "Timed out" : "Canceled"} job ${jobId}`);
		return true;
	} catch (error) {
		console.error(`Failed to ${reason === "timeout" ? "timeout" : "cancel"} job ${jobId}:`, error);
		return false;
	}
}

/**
 * Start monitoring running jobs for timeouts
 */
export function startJobTimeoutMonitor(config: ForgeConfig): void {
	if (timeoutMonitorInterval) {
		console.warn("Timeout monitor already running");
		return;
	}

	console.log(`Starting job timeout monitor (timeout: ${config.jobTimeout}s, check interval: ${config.jobTimeoutCheckInterval}ms)`);

	timeoutMonitorInterval = setInterval(() => {
		const now = Date.now();

		for (const [jobId, job] of runningJobs.entries()) {
			const elapsedSeconds = (now - job.startTime) / 1000;

			if (elapsedSeconds > config.jobTimeout) {
				console.warn(`Job ${jobId} exceeded timeout (${elapsedSeconds.toFixed(0)}s > ${config.jobTimeout}s)`);
				cancelJob(jobId, "timeout");
			}
		}
	}, config.jobTimeoutCheckInterval);
}

/**
 * Stop the timeout monitor
 */
export function stopJobTimeoutMonitor(): void {
	if (timeoutMonitorInterval) {
		clearInterval(timeoutMonitorInterval);
		timeoutMonitorInterval = null;
		console.log("Stopped job timeout monitor");
	}
}

export async function restartJob(
	config: ForgeConfig,
	jobId: number,
): Promise<{ success: boolean; newJobId?: number; error?: string }> {
	const oldJob = getCIJob(jobId);

	if (!oldJob) {
		return { success: false, error: "Job not found" };
	}

	if (oldJob.status === "running" || oldJob.status === "pending") {
		return { success: false, error: "Cannot restart a running or pending job" };
	}

	// Create new job with same parameters
	const logPath = join(
		config.logsPath,
		oldJob.repo,
		`${oldJob.headCommit}.log`,
	);

	const newJobId = insertCIJob({
		repo: oldJob.repo,
		branch: oldJob.branch,
		headCommit: oldJob.headCommit,
		status: "pending",
		logPath,
		startedAt: new Date(),
	});

	// Determine if this is a post-merge job (master branch) or pre-merge
	if (oldJob.branch === "master") {
		runPostMergeJob(config, oldJob.repo, oldJob.headCommit).catch((err) => {
			console.error(`Failed to restart post-merge job ${newJobId}:`, err);
		});
	} else {
		runPreMergeJob(
			config,
			newJobId,
			oldJob.repo,
			oldJob.branch,
			oldJob.headCommit,
		).catch((err) => {
			console.error(`Failed to restart pre-merge job ${newJobId}:`, err);
		});
	}

	return { success: true, newJobId };
}

export async function runPreMergeJob(
	config: ForgeConfig,
	jobId: number,
	repo: string,
	branch: string,
	headCommit: string,
): Promise<void> {
	console.log(
		`Starting pre-merge job ${jobId} for ${repo}/${branch}@${headCommit}`,
	);

	const repoPath = join(config.reposPath, `${repo}.git`);
	const worktreePath = join(config.workPath, repo, String(jobId));
	const logDir = join(config.logsPath, repo);
	const logPath = join(logDir, `${headCommit}.log`);
	const statusPath = join(logDir, `${headCommit}.status`);

	try {
		mkdirSync(logDir, { recursive: true });
		mkdirSync(worktreePath, { recursive: true });

		const worktreeResult = execGit(
			["worktree", "add", "--force", "--detach", worktreePath, headCommit],
			{ cwd: repoPath },
		);

		if (!worktreeResult.success) {
			throw new Error(`Failed to create worktree: ${worktreeResult.stderr}`);
		}

		updateCIJob(jobId, { status: "running" });

		const logStream = createWriteStream(logPath, { flags: "w" });
		seedJobLog(jobId, "");

		const startTime = Date.now();

		// Run nix run .#pre-merge
		const ciProcess = spawn("nix", ["run", ".#pre-merge"], {
			cwd: worktreePath,
			env: {
				...process.env,
				FORGE_REPO: repo,
				FORGE_BRANCH: branch,
				FORGE_COMMIT: headCommit,
			},
		});

		runningJobs.set(jobId, {
			jobId,
			process: ciProcess,
			startTime,
		});

		ciProcess.stdout?.on("data", (data) => {
			logStream.write(data);
			appendJobLogChunk(jobId, data.toString());
		});

		ciProcess.stderr?.on("data", (data) => {
			logStream.write(data);
			appendJobLogChunk(jobId, data.toString());
		});

		const exitCode = await new Promise<number>((resolve) => {
			ciProcess.on("close", (code) => {
				resolve(code ?? 1);
			});
			ciProcess.on("error", (err) => {
				logStream.write(`\nProcess error: ${err.message}\n`);
				resolve(1);
			});
		});

		logStream.end();
		runningJobs.delete(jobId);

		completeJobLog(jobId);

		const finishedAt = new Date();

		// Check if job was already marked as timeout or canceled
		const dbJob = getCIJob(jobId);
		const finalStatus = dbJob && (dbJob.status === "timeout" || dbJob.status === "canceled")
			? dbJob.status
			: (exitCode === 0 ? "passed" : "failed");

		updateCIJob(jobId, {
			status: finalStatus,
			finishedAt,
			exitCode,
		});

		const statusData = {
			status: finalStatus,
			exitCode,
			startedAt: new Date(startTime).toISOString(),
			finishedAt: finishedAt.toISOString(),
			jobId,
		};

		try {
			mkdirSync(logDir, { recursive: true });
			writeFileSync(statusPath, JSON.stringify(statusData, null, 2));
		} catch (writeErr) {
			console.error("Failed to write status file:", writeErr);
		}

		console.log(
			`Pre-merge job ${jobId} completed with status: ${finalStatus} (exit ${exitCode})`,
		);

		if (finalStatus === "passed") {
			const autoMergeResult = tryAutoMerge(
				config,
				repo,
				branch,
				headCommit,
				finalStatus,
			);
			if (autoMergeResult.attempted) {
				if (autoMergeResult.success) {
					console.log(`Auto-merge successful for ${repo}/${branch}`);
				} else {
					console.log(
						`Auto-merge failed for ${repo}/${branch}: ${autoMergeResult.error}`,
					);
				}
			} else {
				console.log(
					`Auto-merge not attempted for ${repo}/${branch}: ${autoMergeResult.error}`,
				);
			}
		}
	} catch (error) {
		console.error(`CI job ${jobId} error:`, error);

		runningJobs.delete(jobId);

		updateCIJob(jobId, {
			status: "failed",
			finishedAt: new Date(),
			exitCode: 1,
		});

		const errorMessage = error instanceof Error ? error.message : String(error);

		try {
			mkdirSync(logDir, { recursive: true });
			writeFileSync(logPath, `CI job failed: ${errorMessage}\n`);

			const statusData = {
				status: "failed",
				exitCode: 1,
				startedAt: new Date().toISOString(),
				finishedAt: new Date().toISOString(),
				jobId,
				error: errorMessage,
			};
			writeFileSync(statusPath, JSON.stringify(statusData, null, 2));
		} catch (writeErr) {
			console.error("Failed to write log/status files:", writeErr);
		}
	} finally {
		if (existsSync(worktreePath)) {
			try {
				execGit(["worktree", "remove", worktreePath], { cwd: repoPath });
			} catch (err) {
				console.error(`Failed to remove worktree ${worktreePath}:`, err);
				try {
					rmSync(worktreePath, { recursive: true, force: true });
				} catch (cleanupErr) {
					console.error("Failed to cleanup worktree directory:", cleanupErr);
				}
			}
		}
	}
}

export function getCPUUsage(jobId: number): number | null {
	const job = runningJobs.get(jobId);
	if (!job || !job.process || !job.process.pid) {
		return null;
	}

	try {
		const output = execSync(`ps -p ${job.process.pid} -o %cpu | tail -n 1`, {
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "ignore"],
		});
		const cpu = Number.parseFloat(output.trim());
		return Number.isNaN(cpu) ? null : cpu;
	} catch (_error) {
		return null;
	}
}

export async function runPostMergeJob(
	config: ForgeConfig,
	repo: string,
	mergeCommit: string,
): Promise<void> {
	console.log(`Starting post-merge job for ${repo}@${mergeCommit}`);

	const jobId = insertCIJob({
		repo,
		branch: "master",
		headCommit: mergeCommit,
		status: "pending",
		logPath: join(config.logsPath, repo, `${mergeCommit}-post-merge.log`),
		startedAt: new Date(),
	});

	const repoPath = join(config.reposPath, `${repo}.git`);
	const worktreePath = join(config.workPath, repo, `post-merge-${jobId}`);
	const logPath = join(config.logsPath, repo, `${mergeCommit}-post-merge.log`);
	const statusPath = join(
		config.logsPath,
		repo,
		`${mergeCommit}-post-merge.status`,
	);

	try {
		mkdirSync(join(config.logsPath, repo), { recursive: true });
		mkdirSync(worktreePath, { recursive: true });

		const worktreeResult = execGit(
			["worktree", "add", "--force", "--detach", worktreePath, mergeCommit],
			{ cwd: repoPath },
		);

		if (!worktreeResult.success) {
			throw new Error(`Failed to create worktree: ${worktreeResult.stderr}`);
		}

		updateCIJob(jobId, { status: "running" });

		const logStream = createWriteStream(logPath, { flags: "w" });
		seedJobLog(jobId, "");

		if (!flakeAppExists(worktreePath, "post-merge")) {
			const message =
				"post-merge app (.#post-merge) not found; skipping post-merge CI.\n";
			logStream.write(message);
			logStream.end();
			appendJobLogChunk(jobId, message);
			updateCIJob(jobId, {
				status: "failed",
				finishedAt: new Date(),
				exitCode: 1,
			});
			completeJobLog(jobId);
			try {
				writeFileSync(
					statusPath,
					JSON.stringify(
						{
							status: "failed",
							exitCode: 1,
							reason: "post-merge app missing",
							finishedAt: new Date().toISOString(),
						},
						null,
						2,
					),
				);
			} catch (err) {
				console.error("Failed to write post-merge status file:", err);
			}
			return;
		}

		const startTime = Date.now();

		// Run nix run .#post-merge
		const postMergeProcess = spawn("nix", ["run", ".#post-merge"], {
			cwd: worktreePath,
			env: { ...process.env },
		});

		runningJobs.set(jobId, {
			jobId,
			process: postMergeProcess,
			startTime,
		});

		postMergeProcess.stdout?.on("data", (data) => {
			logStream.write(data);
			appendJobLogChunk(jobId, data.toString());
		});

		postMergeProcess.stderr?.on("data", (data) => {
			logStream.write(data);
			appendJobLogChunk(jobId, data.toString());
		});

		const exitCode = await new Promise<number>((resolve) => {
			postMergeProcess.on("close", (code) => {
				resolve(code ?? 1);
			});
			postMergeProcess.on("error", (err) => {
				logStream.write(`\nProcess error: ${err.message}\n`);
				resolve(1);
			});
		});

		logStream.end();
		runningJobs.delete(jobId);
		completeJobLog(jobId);

		const finishedAt = new Date();

		// Check if job was already marked as timeout or canceled
		const dbJob = getCIJob(jobId);
		const finalStatus = dbJob && (dbJob.status === "timeout" || dbJob.status === "canceled")
			? dbJob.status
			: (exitCode === 0 ? "passed" : "failed");

		updateCIJob(jobId, {
			status: finalStatus,
			finishedAt,
			exitCode,
		});

		const statusData = {
			status: finalStatus,
			exitCode,
			startedAt: new Date(startTime).toISOString(),
			finishedAt: finishedAt.toISOString(),
		};

		writeFileSync(
			join(config.logsPath, repo, `${mergeCommit}-post-merge.status`),
			JSON.stringify(statusData, null, 2),
		);

		console.log(
			`Post-merge job ${jobId} completed: ${finalStatus} (exit ${exitCode})`,
		);
	} catch (error) {
		console.error(`Post-merge job ${jobId} failed:`, error);
		updateCIJob(jobId, {
			status: "failed",
			finishedAt: new Date(),
			exitCode: 1,
		});
		completeJobLog(jobId);
	} finally {
		try {
			execGit(["worktree", "remove", "--force", worktreePath], {
				cwd: repoPath,
			});
		} catch (err) {
			console.error("Failed to remove worktree:", err);
		}
	}
}
