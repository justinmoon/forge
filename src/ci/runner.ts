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
	readFileSync,
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

interface CICommand {
	command: string;
	args: string[];
	label: string;
}

const runningJobs = new Map<number, RunningJob>();
interface ContainerInfo {
	name: string;
	storageRoot: string;
	runRoot: string;
}
const runningContainers = new Map<number, ContainerInfo>(); // jobId -> container info
let timeoutMonitorInterval: NodeJS.Timeout | null = null;
const PG_PORT_BASE = 20000;
const PG_PORT_RANGE = 20000;

function getJobPgPort(jobId: number): number {
	return PG_PORT_BASE + (jobId % PG_PORT_RANGE);
}

function getContainerName(jobId: number): string {
	return `forge-ci-${jobId}`;
}

function terminateProcess(child: ChildProcess, signal: NodeJS.Signals): void {
	if (child.pid && process.platform !== "win32") {
		try {
			process.kill(-child.pid, signal);
			return;
		} catch (_error) {
			// Fall back to killing the child only.
		}
	}
	child.kill(signal);
}

function stopPostgres(pgDataPath: string): void {
	const pidPath = join(pgDataPath, "postmaster.pid");
	if (!existsSync(pidPath)) {
		return;
	}

	const pgCtlArgs = ["-D", pgDataPath, "stop", "-m", "fast"];
	const tryPgCtl = (command: string, args: string[]): boolean => {
		const result = spawnSync(command, args, {
			stdio: "ignore",
		});
		return result.status === 0;
	};

	if (tryPgCtl("pg_ctl", pgCtlArgs)) {
		return;
	}

	tryPgCtl("nix", [
		"shell",
		"nixpkgs#postgresql_17",
		"-c",
		"pg_ctl",
		...pgCtlArgs,
	]);

	if (!existsSync(pidPath)) {
		return;
	}

	try {
		const pidLine = readFileSync(pidPath, "utf-8").split(/\s+/)[0];
		const pid = Number.parseInt(pidLine, 10);
		if (!Number.isNaN(pid)) {
			process.kill(pid, "SIGTERM");
		}
	} catch (error) {
		console.warn("Failed to stop postgres with pid:", error);
	}
}

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

function justRecipeExists(worktreePath: string, recipe: string): boolean {
	const result = spawnSync("just", ["--list"], {
		cwd: worktreePath,
		encoding: "utf-8",
		stdio: ["ignore", "pipe", "pipe"],
		env: process.env,
	});

	if (result.error || result.status !== 0 || !result.stdout) {
		return false;
	}

	for (const line of result.stdout.split(/\r?\n/)) {
		const match = line.match(/^\s*([A-Za-z0-9_.-]+)\b/);
		if (match?.[1] === recipe) {
			return true;
		}
	}

	return false;
}

function getPreMergeCommand(worktreePath: string): CICommand {
	if (justRecipeExists(worktreePath, "pre-merge")) {
		return {
			command: "just",
			args: ["pre-merge"],
			label: "just pre-merge",
		};
	}

	return {
		command: "nix",
		args: ["run", ".#pre-merge"],
		label: "nix run .#pre-merge",
	};
}

function getPostMergeCommand(worktreePath: string): CICommand | null {
	if (justRecipeExists(worktreePath, "post-merge")) {
		return {
			command: "just",
			args: ["post-merge"],
			label: "just post-merge",
		};
	}

	if (flakeAppExists(worktreePath, "post-merge")) {
		return {
			command: "nix",
			args: ["run", ".#post-merge"],
			label: "nix run .#post-merge",
		};
	}

	return null;
}

interface ContainerJobOptions {
	worktreePath: string;
	ciCommand: CICommand;
	jobId: number;
	repo: string;
	branch: string;
	commit: string;
	image: string;
	network: string;
	tmpfsSize: string;
	storageRoot: string; // Podman storage root (--root)
	runRoot: string; // Podman runtime root (--runroot)
	onOutput: (chunk: string) => void;
}

async function runJobInContainer(
	options: ContainerJobOptions,
): Promise<number> {
	const containerName = getContainerName(options.jobId);

	// --root and --runroot must come before the "run" subcommand
	// This allows rootless podman to work without XDG_RUNTIME_DIR
	const podmanArgs = [
		`--root=${options.storageRoot}`,
		`--runroot=${options.runRoot}`,
		"run",
		"--rm",
		"--name",
		containerName,
		`--network=${options.network}`,
		"--userns=keep-id", // Map host UID to same UID in container
		"-w",
		"/work",
		"--mount",
		`type=bind,source=${options.worktreePath},target=/work`,
		"--mount",
		"type=bind,source=/nix,target=/nix,readonly",
		"--mount",
		`type=tmpfs,target=/tmp,tmpfs-size=${options.tmpfsSize}`,
		"--mount",
		`type=tmpfs,target=/root,tmpfs-size=${options.tmpfsSize}`,
		"--env",
		"HOME=/root",
		"--env",
		`FORGE_REPO=${options.repo}`,
		"--env",
		`FORGE_BRANCH=${options.branch}`,
		"--env",
		`FORGE_COMMIT=${options.commit}`,
		"--env",
		`FORGE_JOB_ID=${options.jobId}`,
		options.image,
		"bash",
		"-lc",
		`cd /work && ${options.ciCommand.command} ${options.ciCommand.args.join(" ")}`,
	];

	const containerProcess = spawn("podman", podmanArgs, {
		stdio: ["ignore", "pipe", "pipe"],
	});

	runningContainers.set(options.jobId, {
		name: containerName,
		storageRoot: options.storageRoot,
		runRoot: options.runRoot,
	});

	containerProcess.stdout?.on("data", (data) => {
		options.onOutput(data.toString());
	});

	containerProcess.stderr?.on("data", (data) => {
		options.onOutput(data.toString());
	});

	return new Promise<number>((resolve) => {
		containerProcess.on("close", (code) => {
			runningContainers.delete(options.jobId);
			resolve(code ?? 1);
		});
		containerProcess.on("error", (err) => {
			runningContainers.delete(options.jobId);
			options.onOutput(`\nContainer error: ${err.message}\n`);
			resolve(1);
		});
	});
}

function killContainer(jobId: number): void {
	const containerInfo = runningContainers.get(jobId);
	if (!containerInfo) {
		return;
	}

	const storageArgs = [
		`--root=${containerInfo.storageRoot}`,
		`--runroot=${containerInfo.runRoot}`,
	];

	try {
		spawnSync("podman", [...storageArgs, "kill", containerInfo.name], {
			stdio: "ignore",
		});
	} catch (_err) {
		// Container may already be stopped
	}

	try {
		spawnSync("podman", [...storageArgs, "rm", "-f", containerInfo.name], {
			stdio: "ignore",
		});
	} catch (_err) {
		// Container may already be removed
	}

	runningContainers.delete(jobId);
}

export function isJobRunning(jobId: number): boolean {
	return runningJobs.has(jobId);
}

export function getRunningJob(jobId: number): RunningJob | undefined {
	return runningJobs.get(jobId);
}

export function cancelJob(jobId: number, reason = "canceled"): boolean {
	const job = runningJobs.get(jobId);
	const hasContainer = runningContainers.has(jobId);

	// If job is not in memory, check if it exists in DB as "running"
	if (!job && !hasContainer) {
		const dbJob = getCIJob(jobId);
		if (dbJob && dbJob.status === "running") {
			// Stuck job - mark as canceled in DB
			updateCIJob(jobId, {
				status: reason,
				finishedAt: new Date(),
				exitCode: reason === "timeout" ? 124 : 143, // 124 for timeout, 143 for SIGTERM
			});
			console.log(
				`${reason === "timeout" ? "Timed out" : "Canceled"} stuck job ${jobId} (no running process found)`,
			);
			return true;
		}
		return false;
	}

	try {
		// Kill container if running in containerized mode
		if (hasContainer) {
			killContainer(jobId);
		}

		// Kill process if running in direct mode
		if (job) {
			terminateProcess(job.process, "SIGTERM");
			runningJobs.delete(jobId);
		}

		updateCIJob(jobId, {
			status: reason,
			finishedAt: new Date(),
			exitCode: reason === "timeout" ? 124 : 143,
		});

		console.log(
			`${reason === "timeout" ? "Timed out" : "Canceled"} job ${jobId}`,
		);
		return true;
	} catch (error) {
		console.error(
			`Failed to ${reason === "timeout" ? "timeout" : "cancel"} job ${jobId}:`,
			error,
		);
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

	console.log(
		`Starting job timeout monitor (timeout: ${config.jobTimeout}s, check interval: ${config.jobTimeoutCheckInterval}ms)`,
	);

	timeoutMonitorInterval = setInterval(() => {
		const now = Date.now();

		for (const [jobId, job] of runningJobs.entries()) {
			const elapsedSeconds = (now - job.startTime) / 1000;

			if (elapsedSeconds > config.jobTimeout) {
				console.warn(
					`Job ${jobId} exceeded timeout (${elapsedSeconds.toFixed(0)}s > ${config.jobTimeout}s)`,
				);
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
	const pgPort = getJobPgPort(jobId);
	const pgDataPath = join(worktreePath, ".pgdata");
	const pgLogPath = join(pgDataPath, "postgres.log");

	// For containerized CI, we use git clone instead of worktrees.
	// Worktrees contain symlinks back to the parent repo which aren't
	// accessible from inside the container. Clones are self-contained.
	const useClone = config.container.enabled;

	try {
		mkdirSync(logDir, { recursive: true });

		if (useClone) {
			// Clone the repo locally and checkout the commit
			const cloneResult = execGit(
				["clone", "--local", "--no-checkout", repoPath, worktreePath],
				{ cwd: config.reposPath },
			);
			if (!cloneResult.success) {
				throw new Error(`Failed to clone repo: ${cloneResult.stderr}`);
			}
			const checkoutResult = execGit(
				["checkout", "--detach", headCommit],
				{ cwd: worktreePath },
			);
			if (!checkoutResult.success) {
				throw new Error(`Failed to checkout commit: ${checkoutResult.stderr}`);
			}
		} else {
			// Use worktrees for direct mode (faster, shares objects)
			mkdirSync(worktreePath, { recursive: true });
			const worktreeResult = execGit(
				["worktree", "add", "--force", "--detach", worktreePath, headCommit],
				{ cwd: repoPath },
			);
			if (!worktreeResult.success) {
				throw new Error(`Failed to create worktree: ${worktreeResult.stderr}`);
			}
		}

		updateCIJob(jobId, { status: "running" });

		const logStream = createWriteStream(logPath, { flags: "w" });
		seedJobLog(jobId, "");

		const startTime = Date.now();

		const ciCommand = getPreMergeCommand(worktreePath);
		const modeLabel = config.container.enabled ? "[container]" : "[direct]";
		logStream.write(`Forge ${modeLabel}: running ${ciCommand.label}\n`);
		appendJobLogChunk(jobId, `Forge ${modeLabel}: running ${ciCommand.label}\n`);

		let exitCode: number;

		if (config.container.enabled) {
			// Run in container
			exitCode = await runJobInContainer({
				worktreePath,
				ciCommand,
				jobId,
				repo,
				branch,
				commit: headCommit,
				image: config.container.image,
				network: config.container.network,
				tmpfsSize: config.container.tmpfsSize,
				storageRoot: config.container.storageRoot,
				runRoot: config.container.runRoot,
				onOutput: (chunk) => {
					logStream.write(chunk);
					appendJobLogChunk(jobId, chunk);
				},
			});
		} else {
			// Run directly on host
			const ciProcess = spawn(ciCommand.command, ciCommand.args, {
				cwd: worktreePath,
				detached: true,
				env: {
					...process.env,
					FORGE_REPO: repo,
					FORGE_BRANCH: branch,
					FORGE_COMMIT: headCommit,
					FORGE_JOB_ID: String(jobId),
					PGPORT: String(pgPort),
					PG_PORT: String(pgPort),
					PGDATA: pgDataPath,
					PGLOGFILE: pgLogPath,
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

			exitCode = await new Promise<number>((resolve) => {
				ciProcess.on("close", (code) => {
					resolve(code ?? 1);
				});
				ciProcess.on("error", (err) => {
					logStream.write(`\nProcess error: ${err.message}\n`);
					resolve(1);
				});
			});

			runningJobs.delete(jobId);
		}

		logStream.end();
		completeJobLog(jobId);

		const finishedAt = new Date();

		// Check if job was already marked as timeout or canceled
		const dbJob = getCIJob(jobId);
		const finalStatus =
			dbJob && (dbJob.status === "timeout" || dbJob.status === "canceled")
				? dbJob.status
				: exitCode === 0
					? "passed"
					: "failed";

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
		try {
			stopPostgres(pgDataPath);
			if (existsSync(pgDataPath)) {
				rmSync(pgDataPath, { recursive: true, force: true });
			}
		} catch (cleanupErr) {
			console.error(
				`Failed to clean up postgres data at ${pgDataPath}:`,
				cleanupErr,
			);
		}

		if (existsSync(worktreePath)) {
			try {
				if (useClone) {
					// For clones, just rm -rf the directory
					rmSync(worktreePath, { recursive: true, force: true });
				} else {
					// For worktrees, use git worktree remove
					execGit(["worktree", "remove", worktreePath], { cwd: repoPath });
				}
			} catch (err) {
				console.error(`Failed to remove ${useClone ? "clone" : "worktree"} ${worktreePath}:`, err);
				try {
					rmSync(worktreePath, { recursive: true, force: true });
				} catch (cleanupErr) {
					console.error("Failed to cleanup directory:", cleanupErr);
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
	const pgPort = getJobPgPort(jobId);
	const pgDataPath = join(worktreePath, ".pgdata");
	const pgLogPath = join(pgDataPath, "postgres.log");

	// For containerized CI, we use git clone instead of worktrees.
	// Worktrees contain symlinks back to the parent repo which aren't
	// accessible from inside the container. Clones are self-contained.
	const useClone = config.container.enabled;

	try {
		mkdirSync(join(config.logsPath, repo), { recursive: true });

		if (useClone) {
			// Clone the repo locally and checkout the commit
			const cloneResult = execGit(
				["clone", "--local", "--no-checkout", repoPath, worktreePath],
				{ cwd: config.reposPath },
			);
			if (!cloneResult.success) {
				throw new Error(`Failed to clone repo: ${cloneResult.stderr}`);
			}
			const checkoutResult = execGit(
				["checkout", "--detach", mergeCommit],
				{ cwd: worktreePath },
			);
			if (!checkoutResult.success) {
				throw new Error(`Failed to checkout commit: ${checkoutResult.stderr}`);
			}
		} else {
			// Use worktrees for direct mode (faster, shares objects)
			mkdirSync(worktreePath, { recursive: true });
			const worktreeResult = execGit(
				["worktree", "add", "--force", "--detach", worktreePath, mergeCommit],
				{ cwd: repoPath },
			);
			if (!worktreeResult.success) {
				throw new Error(`Failed to create worktree: ${worktreeResult.stderr}`);
			}
		}

		updateCIJob(jobId, { status: "running" });

		const logStream = createWriteStream(logPath, { flags: "w" });
		seedJobLog(jobId, "");

		const ciCommand = getPostMergeCommand(worktreePath);
		if (!ciCommand) {
			const message =
				"post-merge command not found; expected `just post-merge` or `nix run .#post-merge`.\n";
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

		const modeLabel = config.container.enabled ? "[container]" : "[direct]";
		logStream.write(`Forge ${modeLabel}: running ${ciCommand.label}\n`);
		appendJobLogChunk(jobId, `Forge ${modeLabel}: running ${ciCommand.label}\n`);

		let exitCode: number;

		if (config.container.enabled) {
			// Run in container
			exitCode = await runJobInContainer({
				worktreePath,
				ciCommand,
				jobId,
				repo,
				branch: "master",
				commit: mergeCommit,
				image: config.container.image,
				network: config.container.network,
				tmpfsSize: config.container.tmpfsSize,
				storageRoot: config.container.storageRoot,
				runRoot: config.container.runRoot,
				onOutput: (chunk) => {
					logStream.write(chunk);
					appendJobLogChunk(jobId, chunk);
				},
			});
		} else {
			// Run directly on host
			const postMergeProcess = spawn(ciCommand.command, ciCommand.args, {
				cwd: worktreePath,
				detached: true,
				env: {
					...process.env,
					FORGE_JOB_ID: String(jobId),
					PGPORT: String(pgPort),
					PG_PORT: String(pgPort),
					PGDATA: pgDataPath,
					PGLOGFILE: pgLogPath,
				},
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

			exitCode = await new Promise<number>((resolve) => {
				postMergeProcess.on("close", (code) => {
					resolve(code ?? 1);
				});
				postMergeProcess.on("error", (err) => {
					logStream.write(`\nProcess error: ${err.message}\n`);
					resolve(1);
				});
			});

			runningJobs.delete(jobId);
		}

		logStream.end();
		completeJobLog(jobId);

		const finishedAt = new Date();

		// Check if job was already marked as timeout or canceled
		const dbJob = getCIJob(jobId);
		const finalStatus =
			dbJob && (dbJob.status === "timeout" || dbJob.status === "canceled")
				? dbJob.status
				: exitCode === 0
					? "passed"
					: "failed";

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
			stopPostgres(pgDataPath);
			if (existsSync(pgDataPath)) {
				rmSync(pgDataPath, { recursive: true, force: true });
			}
		} catch (cleanupErr) {
			console.error(
				`Failed to clean up postgres data at ${pgDataPath}:`,
				cleanupErr,
			);
		}

		if (existsSync(worktreePath)) {
			try {
				if (useClone) {
					// For clones, just rm -rf the directory
					rmSync(worktreePath, { recursive: true, force: true });
				} else {
					// For worktrees, use git worktree remove
					execGit(["worktree", "remove", "--force", worktreePath], {
						cwd: repoPath,
					});
				}
			} catch (err) {
				console.error(`Failed to remove ${useClone ? "clone" : "worktree"}:`, err);
				try {
					rmSync(worktreePath, { recursive: true, force: true });
				} catch (cleanupErr) {
					console.error("Failed to cleanup directory:", cleanupErr);
				}
			}
		}
	}
}
