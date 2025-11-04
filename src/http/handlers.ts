import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Event as NostrEvent } from "nostr-tools";
import { isWhitelisted, verifySignedEvent } from "../auth/nostr";
import { createSession, deleteSession } from "../auth/session";
import {
	cancelJob,
	getCPUUsage,
	restartJob,
	runPostMergeJob,
	runPreMergeJob,
} from "../ci/runner";
import { getCIStatus, readCILog } from "../ci/status";
import {
	cancelPendingJobs,
	deletePreview,
	getCIJob,
	getLatestCIJob,
	getMergeHistory,
	getPreviewByBranch,
	getPreviewBySubdomain,
	insertCIJob,
	insertMergeHistory,
	listCIJobs,
	registerPreview,
	updateCIJob,
} from "../db";
import { getHeadCommit, listFeatureBranches } from "../git/branches";
import { getDiff, getMergeMetadata } from "../git/merge";
import { executeMerge } from "../git/merge-execute";
import { hasAutoMergeTrailer } from "../git/trailers";
import {
	type JobEventPayload,
	createJobEventStream,
} from "../realtime/job-events";
import {
	appendJobLogChunk,
	completeJobLog,
	ensureJobLog,
	seedJobLog,
	streamJobLog,
} from "../realtime/log-stream";
import type { CIJob, ForgeConfig, MergeRequest } from "../types";
import {
	createRepository,
	deleteRepository,
	getRepoPath,
	listRepos,
} from "../utils/repos";
import { renderHistory } from "../views/history";
import {
	renderJobDetail,
	renderJobsDashboard,
	renderJobsScript,
} from "../views/jobs";
import { renderLogin } from "../views/login";
import {
	renderMRDetail,
	renderMRDetailScript,
	renderMRList,
	renderMRListScript,
} from "../views/merge-requests";
import {
	renderCreateRepoForm,
	renderDeleteConfirmation,
	renderRepoCreated,
	renderRepoList,
} from "../views/repos";
import { getSessionCookie } from "./middleware";
import { htmlResponse, jsonError, jsonResponse } from "./router";

// Store active challenges with IP binding and rate limiting
interface ChallengeEntry {
	issuedAt: number;
	ip: string; // TCP connection address or forwarded IP
}

const activeChallenges = new Map<string, ChallengeEntry>();
const CHALLENGE_MAX_AGE = 5 * 60 * 1000; // 5 minutes
const CHALLENGE_RATE_LIMIT = 5; // per IP per minute
const CHALLENGE_GLOBAL_LIMIT = 1000;

// Get request IP - use direct connection address or trusted proxy headers
function getRequestIP(
	req: Request,
	trustProxy: boolean,
	directIP?: string,
): string {
	// If behind a trusted proxy, prefer forwarded headers for original client IP
	if (trustProxy) {
		const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0].trim();
		if (forwarded) return forwarded;

		const realIp = req.headers.get("x-real-ip");
		if (realIp) return realIp;
	}

	// Fall back to direct connection IP (always trustworthy, from TCP connection)
	// This is the remote address from Bun's server.requestIP(req)
	if (directIP) return directIP;

	// Should never happen, but return a sentinel if we somehow have no IP
	return "unknown";
}

// Count challenges issued to an IP in the last minute
function countRecentChallengesForIP(ip: string): number {
	const oneMinuteAgo = Date.now() - 60 * 1000;
	let count = 0;
	for (const entry of activeChallenges.values()) {
		if (entry.ip === ip && entry.issuedAt > oneMinuteAgo) {
			count++;
		}
	}
	return count;
}

// Clean up old challenges periodically
setInterval(() => {
	const now = Date.now();
	for (const [challenge, entry] of activeChallenges.entries()) {
		if (now - entry.issuedAt > CHALLENGE_MAX_AGE) {
			activeChallenges.delete(challenge);
		}
	}
}, 60 * 1000); // Every minute

type Handler = (
	req: Request,
	params: Record<string, string>,
) => Promise<Response>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isStringArray(value: unknown): value is string[] {
	return (
		Array.isArray(value) && value.every((item) => typeof item === "string")
	);
}

function isNostrEvent(value: unknown): value is NostrEvent {
	if (!isRecord(value)) {
		return false;
	}

	return (
		typeof value.id === "string" &&
		typeof value.pubkey === "string" &&
		typeof value.sig === "string" &&
		typeof value.content === "string" &&
		typeof value.kind === "number" &&
		typeof value.created_at === "number" &&
		Array.isArray(value.tags) &&
		value.tags.every(isStringArray)
	);
}

function jobToSummary(job: CIJob): JobEventPayload {
	return {
		id: job.id,
		repo: job.repo,
		branch: job.branch,
		headCommit: job.headCommit,
		status: job.status,
		exitCode: job.exitCode ?? null,
		startedAt: job.startedAt.toISOString(),
		finishedAt: job.finishedAt ? job.finishedAt.toISOString() : null,
	};
}

function filterActiveJobs(jobs: CIJob[]): JobEventPayload[] {
	return jobs
		.filter((job) => job.status === "running" || job.status === "pending")
		.map(jobToSummary);
}

export function createHandlers(
	config: ForgeConfig,
	getDirectIP: (req: Request) => string,
) {
	const decodeParam = (value: string): string => {
		try {
			return decodeURIComponent(value);
		} catch {
			return value;
		}
	};

	const baseHandlers: Record<string, Handler> = {
		getRoot: async (_req: Request, _params: Record<string, string>) => {
			const repos = listRepos(config.reposPath);
			return htmlResponse(renderRepoList(repos));
		},

		getCreate: async (_req: Request, _params: Record<string, string>) => {
			return htmlResponse(renderCreateRepoForm());
		},

		postCreate: async (req: Request, _params: Record<string, string>) => {
			try {
				const formData = await req.formData();
				const name = formData.get("name") as string;

				const result = createRepository(config, name);

				if (!result.success) {
					return htmlResponse(renderCreateRepoForm(result.error), 400);
				}

				// In dev mode, use file:// protocol for easy local cloning
				const cloneUrl = config.isDevelopment
					? `file://${join(config.reposPath, `${name}.git`)}`
					: config.domain
						? `forge@${config.domain}:${name}.git`
						: `git@localhost:${name}.git`;
				const webUrl = `/r/${name}`;

				return htmlResponse(renderRepoCreated(name, cloneUrl, webUrl));
			} catch (_error) {
				return htmlResponse(renderCreateRepoForm("Invalid request"), 400);
			}
		},

		getDeleteConfirm: async (_req: Request, params: Record<string, string>) => {
			const { repo } = params;
			const repoPath = getRepoPath(config.reposPath, repo);
			const { existsSync } = await import("node:fs");

			if (!existsSync(repoPath)) {
				return htmlResponse("<h1>Repository not found</h1>", 404);
			}

			return htmlResponse(renderDeleteConfirmation(repo));
		},

		postDelete: async (req: Request, params: Record<string, string>) => {
			const { repo } = params;

			try {
				const formData = await req.formData();
				const confirm = formData.get("confirm") as string;

				if (confirm !== repo) {
					return jsonError(400, "Repository name does not match");
				}

				const result = deleteRepository(config, repo);

				if (!result.success) {
					return jsonError(400, result.error ?? "Failed to delete repository");
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
			} catch (_error) {
				return jsonError(400, "Invalid request");
			}
		},

		getRepo: async (_req: Request, params: Record<string, string>) => {
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
						metadata.headCommit,
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

			const html = renderMRList(repo, mrs);
			const withScript = html.replace(
				"</body>",
				`${renderMRListScript(repo)}</body>`,
			);
			return htmlResponse(withScript);
		},

		getMergeRequest: async (_req: Request, params: Record<string, string>) => {
			const { repo, branch } = params;
			const decodedBranch = decodeParam(branch);
			const repoPath = getRepoPath(config.reposPath, repo);

			const metadata = getMergeMetadata(repoPath, decodedBranch);
			if (!metadata) {
				return htmlResponse("<h1>Branch not found</h1>", 404);
			}

			const ciStatus = getCIStatus(
				config.logsPath,
				repo,
				decodedBranch,
				metadata.headCommit,
			);
			const autoMerge = hasAutoMergeTrailer(repoPath, metadata.headCommit);

			const mr: MergeRequest = {
				repo,
				branch: decodedBranch,
				headCommit: metadata.headCommit,
				mergeBase: metadata.mergeBase,
				aheadCount: metadata.aheadCount,
				behindCount: metadata.behindCount,
				hasConflicts: metadata.hasConflicts,
				ciStatus,
				autoMerge,
			};

			const latestJob = getLatestCIJob(
				repo,
				decodedBranch,
				metadata.headCommit,
			);
			const diff = getDiff(repoPath, metadata.mergeBase, metadata.headCommit);
			const preview = getPreviewByBranch(repo, decodedBranch);
			const previewUrl = preview
				? `https://${preview.subdomain}.${config.domain || "forge.example.com"}`
				: null;

			const detailHtml = renderMRDetail(repo, mr, diff, latestJob, previewUrl);
			const detailWithScripts = detailHtml.replace(
				"</body>",
				`${renderMRDetailScript(repo, decodedBranch, {
					autoMerge,
					hasConflicts: metadata.hasConflicts,
					latestJob: latestJob ? jobToSummary(latestJob) : null,
				})}</body>`,
			);

			return htmlResponse(detailWithScripts);
		},

		getHistory: async (_req: Request, params: Record<string, string>) => {
			const { repo } = params;
			const history = getMergeHistory(repo, 100);
			return htmlResponse(renderHistory(repo, history));
		},

		getCILog: async (_req: Request, params: Record<string, string>) => {
			const { repo, commit } = params;
			const logPath = join(config.logsPath, repo, `${commit}.log`);

			if (!existsSync(logPath)) {
				return htmlResponse(
					"<h1>Log not found</h1><p>The CI log has been pruned or does not exist.</p>",
					404,
				);
			}

			const logContent = readCILog(logPath);
			const { escapeHtml } = await import("../views/layout");

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

		getJobs: async (_req: Request, _params: Record<string, string>) => {
			const jobs = listCIJobs(100);

			const cpuUsages = new Map<number, number | null>();
			for (const job of jobs) {
				if (job.status === "running") {
					cpuUsages.set(job.id, getCPUUsage(job.id));
				}
			}

			const jobSummaries = jobs.map(jobToSummary);

			const html = renderJobsDashboard(jobs, cpuUsages);
			const withScript = html.replace(
				"</body>",
				`${renderJobsScript(jobSummaries)}</body>`,
			);

			return htmlResponse(withScript);
		},

		getJobDetail: async (_req: Request, params: Record<string, string>) => {
			const jobId = Number.parseInt(params.jobId, 10);

			if (Number.isNaN(jobId)) {
				return htmlResponse("<h1>Invalid job ID</h1>", 400);
			}

			const job = getCIJob(jobId);

			if (!job) {
				return htmlResponse("<h1>Job not found</h1>", 404);
			}

			let logContent: string | null = null;
			let logDeleted = false;

			if (existsSync(job.logPath)) {
				logContent = readCILog(job.logPath);
			} else {
				logDeleted = true;
			}

			const cpuUsage = job.status === "running" ? getCPUUsage(job.id) : null;

			return htmlResponse(
				renderJobDetail(job, logContent, logDeleted, cpuUsage),
			);
		},

		getJobLogStream: async (_req: Request, params: Record<string, string>) => {
			const jobId = Number.parseInt(params.jobId, 10);

			if (Number.isNaN(jobId)) {
				return jsonError(400, "Invalid job ID");
			}

			const job = getCIJob(jobId);

			if (!job) {
				return jsonError(404, "Job not found");
			}

			ensureJobLog(job.id, job.logPath);
			return streamJobLog(job.id);
		},

		getJobEvents: async (_req: Request, _params: Record<string, string>) => {
			const jobs = listCIJobs(200);
			return createJobEventStream(filterActiveJobs(jobs));
		},

		postCancelJob: async (_req: Request, params: Record<string, string>) => {
			const jobId = Number.parseInt(params.jobId, 10);

			if (Number.isNaN(jobId)) {
				return jsonError(400, "Invalid job ID");
			}

			const success = cancelJob(jobId);

			if (!success) {
				return jsonError(404, "Job not found or not running");
			}

			return jsonResponse({
				success: true,
				message: "Job canceled",
			});
		},

		postRestartJob: async (_req: Request, params: Record<string, string>) => {
			const jobId = Number.parseInt(params.jobId, 10);

			if (Number.isNaN(jobId)) {
				return jsonError(400, "Invalid job ID");
			}

			const result = await restartJob(config, jobId);

			if (!result.success) {
				return jsonError(400, result.error || "Failed to restart job");
			}

			return jsonResponse({
				success: true,
				message: "Job restarted",
				newJobId: result.newJobId,
			});
		},

		postMerge: async (_req: Request, params: Record<string, string>) => {
			const { repo, branch } = params;
			const decodedBranch = decodeParam(branch);

			const repoPath = getRepoPath(config.reposPath, repo);

			const metadata = getMergeMetadata(repoPath, decodedBranch);
			if (!metadata) {
				return jsonError(404, "Branch not found");
			}

			const ciStatus = getCIStatus(
				config.logsPath,
				repo,
				decodedBranch,
				metadata.headCommit,
			);

			if (ciStatus !== "passed") {
				return jsonError(400, "CI must pass before merging");
			}

			if (metadata.hasConflicts) {
				return jsonError(400, "Branch has conflicts with master");
			}

			const result = executeMerge(repoPath, decodedBranch);

			if (!result.success || !result.mergeCommit) {
				return jsonError(500, result.error || "Merge failed");
			}

			const mergeCommit = result.mergeCommit;

			insertMergeHistory({
				repo,
				branch: decodedBranch,
				headCommit: metadata.headCommit,
				mergeCommit,
				mergedAt: new Date(),
				ciStatus,
				ciLogPath: null,
			});

			// Clean up preview (branch is merged)
			deletePreview(repo, decodedBranch);

			// Trigger post-merge job (fire and forget)
			runPostMergeJob(config, repo, mergeCommit).catch((err) => {
				console.error("Failed to start post-merge job:", err);
			});

			return jsonResponse({
				success: true,
				mergeCommit,
				message: "Merge successful",
			});
		},

		postDeleteBranch: async (_req: Request, params: Record<string, string>) => {
			const { repo, branch } = params;
			const decodedBranch = decodeParam(branch);

			if (decodedBranch === "master") {
				return jsonError(400, "Cannot delete master branch");
			}

			const repoPath = getRepoPath(config.reposPath, repo);
			const { execGit } = await import("../git/exec");

			const deleteResult = execGit(
				["update-ref", "-d", `refs/heads/${decodedBranch}`],
				{ cwd: repoPath },
			);

			if (!deleteResult.success) {
				return jsonError(500, deleteResult.stderr || "Failed to delete branch");
			}

			// Cancel any pending CI jobs for this branch
			cancelPendingJobs(repo, decodedBranch);

			return jsonResponse({
				success: true,
				message: "Branch deleted",
			});
		},

		postReceive: async (req: Request, _params: Record<string, string>) => {
			try {
				const payload = await req.json();
				if (!isRecord(payload)) {
					return jsonError(400, "Invalid JSON payload");
				}

				const { repo, ref } = payload;
				const oldrev =
					typeof payload.oldrev === "string" ? payload.oldrev : undefined;
				const newrev =
					typeof payload.newrev === "string" ? payload.newrev : undefined;
				const deleted = payload.deleted === true;

				if (typeof repo !== "string" || typeof ref !== "string") {
					return jsonError(400, "Missing required fields: repo, ref");
				}

				console.log("Post-receive hook:", {
					repo,
					ref,
					oldrev,
					newrev,
					deleted,
				});

				if (!repo || !ref) {
					return jsonError(400, "Missing required fields: repo, ref");
				}

				const branch = ref.replace("refs/heads/", "");

				if (branch === "master") {
					// Trigger post-merge job for master branch updates
					const repoPath = getRepoPath(config.reposPath, repo);
					const headCommit = getHeadCommit(repoPath, "master");

					if (headCommit) {
						runPostMergeJob(config, repo, headCommit).catch((err) => {
							console.error(
								`Failed to start post-merge job for ${repo}@${headCommit}:`,
								err,
							);
						});
						return jsonResponse({
							status: "ok",
							message: "Master branch updated, post-merge triggered",
						});
					}

					return jsonResponse({
						status: "ok",
						message: "Master branch updated, no commit found",
					});
				}

				if (deleted) {
					cancelPendingJobs(repo, branch);
					deletePreview(repo, branch);
					return jsonResponse({
						status: "ok",
						message: "Branch deleted, jobs canceled",
					});
				}

				const repoPath = getRepoPath(config.reposPath, repo);
				const headCommit = getHeadCommit(repoPath, branch);

				if (!headCommit) {
					return jsonResponse({ status: "ok", message: "Branch not found" });
				}

				cancelPendingJobs(repo, branch);

				const logPath = join(config.logsPath, repo, `${headCommit}.log`);

				const jobId = insertCIJob({
					repo,
					branch,
					headCommit,
					status: "pending",
					logPath,
					startedAt: new Date(),
				});

				const autoMerge = hasAutoMergeTrailer(repoPath, headCommit);

				runPreMergeJob(config, jobId, repo, branch, headCommit).catch((err) => {
					console.error(`Failed to run pre-merge job ${jobId}:`, err);
				});

				return jsonResponse({
					status: "ok",
					message: "CI job created",
					jobId,
					autoMerge,
				});
			} catch (error) {
				console.error("Post-receive error:", error);
				return jsonError(400, `Invalid request: ${String(error)}`);
			}
		},

		getLogin: async (_req: Request, _params: Record<string, string>) => {
			return htmlResponse(renderLogin());
		},

		getAuthChallenge: async (req: Request, _params: Record<string, string>) => {
			const directIP = getDirectIP(req);
			const ip = getRequestIP(req, config.trustProxy, directIP);

			// Check global limit (always enforced)
			if (activeChallenges.size >= CHALLENGE_GLOBAL_LIMIT) {
				return jsonError(
					503,
					"Service temporarily unavailable. Too many active auth attempts.",
				);
			}

			// Check per-IP rate limit (always enforced with real client address)
			const recentCount = countRecentChallengesForIP(ip);
			if (recentCount >= CHALLENGE_RATE_LIMIT) {
				return jsonError(
					429,
					"Too many authentication attempts. Please wait a moment.",
				);
			}

			// Generate random challenge
			const challenge = randomBytes(32).toString("hex");

			// Store challenge with timestamp and IP binding
			activeChallenges.set(challenge, {
				issuedAt: Date.now(),
				ip,
			});

			return jsonResponse({ challenge });
		},

		postAuthVerify: async (req: Request, _params: Record<string, string>) => {
			try {
				const payload = await req.json();
				if (
					!isRecord(payload) ||
					typeof payload.challenge !== "string" ||
					!isNostrEvent(payload.event)
				) {
					return jsonError(400, "Missing event or challenge");
				}

				const { challenge } = payload;
				const event = payload.event;

				// Verify challenge was issued by us
				const challengeEntry = activeChallenges.get(challenge);
				if (!challengeEntry) {
					return jsonError(401, "Invalid or expired challenge");
				}

				// Verify IP matches (always enforced - prevents challenge theft)
				const directIP = getDirectIP(req);
				const ip = getRequestIP(req, config.trustProxy, directIP);
				if (challengeEntry.ip !== ip) {
					activeChallenges.delete(challenge);
					return jsonError(401, "Challenge IP mismatch");
				}

				// Verify challenge age (defense in depth - should be caught by cleanup)
				const age = Date.now() - challengeEntry.issuedAt;
				if (age > CHALLENGE_MAX_AGE) {
					activeChallenges.delete(challenge);
					return jsonError(401, "Challenge expired");
				}

				// Remove challenge (single use)
				activeChallenges.delete(challenge);

				// Verify signed event
				if (!verifySignedEvent(event, challenge)) {
					return jsonError(401, "Invalid signature");
				}

				// Check if pubkey is whitelisted
				if (!isWhitelisted(event.pubkey, config.allowedPubkeys)) {
					return jsonError(403, "Access denied: pubkey not whitelisted");
				}

				// Create session
				const sessionId = createSession(event.pubkey);

				// Set session cookie
				const response = jsonResponse({
					success: true,
					message: "Authentication successful",
				});

				// Set cookie (HttpOnly always, Secure unless in dev mode, 1 year expiration)
				const cookieOptions = [
					"HttpOnly",
					"Path=/",
					"Max-Age=31536000", // 1 year
					"SameSite=Lax",
				];

				// Always set Secure flag unless in development mode
				if (!config.isDevelopment) {
					cookieOptions.push("Secure");
				}

				response.headers.set(
					"Set-Cookie",
					`forge_session=${sessionId}; ${cookieOptions.join("; ")}`,
				);

				return response;
			} catch (error) {
				console.error("Auth verify error:", error);
				return jsonError(400, `Invalid request: ${String(error)}`);
			}
		},

		postRegisterPreview: async (
			req: Request,
			_params: Record<string, string>,
		) => {
			try {
				const payload = await req.json();
				if (!isRecord(payload)) {
					return jsonError(400, "Invalid JSON payload");
				}

				const { repo, branch, port } = payload;

				if (
					typeof repo !== "string" ||
					typeof branch !== "string" ||
					typeof port !== "number"
				) {
					return jsonError(400, "Missing required fields: repo, branch, port");
				}

				if (port < 1 || port > 65535) {
					return jsonError(400, "Invalid port number");
				}

				// Generate subdomain (deterministic hash)
				const crypto = await import("node:crypto");
				const hash = crypto
					.createHash("md5")
					.update(`${repo}:${branch}`)
					.digest("hex")
					.substring(0, 8);
				const subdomain = `preview-${hash}`;

				// Register preview
				registerPreview(subdomain, repo, branch, port);

				const domain = config.domain || "forge.example.com";
				const url = `https://${subdomain}.${domain}`;

				console.log(`Registered preview: ${url} → localhost:${port}`);

				return jsonResponse({
					success: true,
					subdomain,
					url,
					port,
				});
			} catch (error) {
				console.error("Register preview error:", error);
				return jsonError(400, `Invalid request: ${String(error)}`);
			}
		},

		postLogout: async (req: Request, _params: Record<string, string>) => {
			const sessionId = getSessionCookie(req);

			if (sessionId) {
				deleteSession(sessionId);
			}

			// Clear session cookie
			const response = new Response("", {
				status: 302,
				headers: {
					Location: "/login",
					"Set-Cookie": "forge_session=; HttpOnly; Path=/; Max-Age=0",
				},
			});

			return response;
		},

		proxyPreview: async (req: Request, _params: Record<string, string>) => {
			try {
				const url = new URL(req.url);
				const host = url.hostname;

				// Extract subdomain
				const match = host.match(/^(preview-[a-f0-9]+)\./);
				if (!match) {
					return htmlResponse(
						"<h1>Not Found</h1><p>Invalid preview subdomain</p>",
						404,
					);
				}

				const subdomain = match[1];
				const preview = getPreviewBySubdomain(subdomain);

				if (!preview) {
					return htmlResponse(
						`<h1>Preview Not Found</h1><p>Preview "${subdomain}" does not exist or has been deleted.</p>`,
						404,
					);
				}

				// Proxy to the preview port
				try {
					const targetUrl = `http://localhost:${preview.port}${url.pathname}${url.search}`;
					const proxyResponse = await fetch(targetUrl, {
						method: req.method,
						headers: req.headers,
						body:
							req.method !== "GET" && req.method !== "HEAD"
								? req.body
								: undefined,
					});

					return new Response(proxyResponse.body, {
						status: proxyResponse.status,
						statusText: proxyResponse.statusText,
						headers: proxyResponse.headers,
					});
				} catch (proxyError) {
					console.error(
						`Failed to proxy to preview ${subdomain}:${preview.port}:`,
						proxyError,
					);
					return htmlResponse(
						`<h1>Preview Unavailable</h1><p>Could not connect to preview at port ${preview.port}.</p>`,
						502,
					);
				}
			} catch (error) {
				console.error("Proxy preview error:", error);
				return htmlResponse("<h1>Internal Server Error</h1>", 500);
			}
		},
	};

	const handlers = baseHandlers as Record<string, Handler> & {
		postTestCreateJob?: Handler;
		postTestAppendLog?: Handler;
		postTestFinishJob?: Handler;
	};

	if (config.isDevelopment) {
		handlers.postTestCreateJob = async (req: Request) => {
			try {
				const payload = (await req.json()) as {
					repo: string;
					branch?: string;
					headCommit?: string;
					status?: string;
					log?: string;
				};

				const repo = payload.repo?.trim();
				if (!repo) {
					return jsonError(400, "repo is required");
				}

				const branch = payload.branch?.trim() || "test-branch";
				const headCommit =
					payload.headCommit?.trim() || randomBytes(20).toString("hex");
				const status = payload.status || "running";
				const logContent = payload.log ?? "";

				const repoPath = getRepoPath(config.reposPath, repo);
				if (!existsSync(repoPath)) {
					const created = createRepository(config, repo);
					if (!created.success) {
						return jsonError(
							500,
							created.error || "Failed to create repository",
						);
					}
				}

				const logDir = join(config.logsPath, repo);
				mkdirSync(logDir, { recursive: true });
				const logPath = join(logDir, `${headCommit}.log`);
				writeFileSync(logPath, logContent, { encoding: "utf-8" });

				const jobId = insertCIJob({
					repo,
					branch,
					headCommit,
					status,
					logPath,
					startedAt: new Date(),
				});

				seedJobLog(jobId, logContent);

				return jsonResponse({ jobId, repo, branch, headCommit });
			} catch (error) {
				console.error("postTestCreateJob error:", error);
				return jsonError(500, "Failed to create test job");
			}
		};

		handlers.postTestAppendLog = async (
			req: Request,
			params: Record<string, string>,
		) => {
			try {
				const jobId = Number.parseInt(params.jobId, 10);
				if (Number.isNaN(jobId)) {
					return jsonError(400, "Invalid job ID");
				}

				const job = getCIJob(jobId);
				if (!job) {
					return jsonError(404, "Job not found");
				}

				const payload = (await req.json()) as { chunk: string };
				const chunk = payload.chunk ?? "";

				appendFileSync(job.logPath, chunk, { encoding: "utf-8" });
				appendJobLogChunk(jobId, chunk);

				return jsonResponse({ ok: true });
			} catch (error) {
				console.error("postTestAppendLog error:", error);
				return jsonError(500, "Failed to append log chunk");
			}
		};

		handlers.postTestFinishJob = async (
			req: Request,
			params: Record<string, string>,
		) => {
			try {
				const jobId = Number.parseInt(params.jobId, 10);
				if (Number.isNaN(jobId)) {
					return jsonError(400, "Invalid job ID");
				}

				const job = getCIJob(jobId);
				if (!job) {
					return jsonError(404, "Job not found");
				}

				const payload = (await req.json().catch(() => ({}))) as {
					status?: string;
					exitCode?: number;
				};
				const status = payload.status || "passed";
				const exitCode = payload.exitCode ?? 0;

				completeJobLog(jobId);
				updateCIJob(jobId, {
					status,
					finishedAt: new Date(),
					exitCode,
				});

				return jsonResponse({ ok: true });
			} catch (error) {
				console.error("postTestFinishJob error:", error);
				return jsonError(500, "Failed to finish job");
			}
		};
	}

	return handlers;
}
