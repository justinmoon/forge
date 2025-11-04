import { Database } from "bun:sqlite";
import { MIGRATIONS } from "./schema";
import type { MergeHistoryEntry, CIJob } from "../types";
import {
	broadcastJobEvent,
	type JobEventPayload,
} from "../realtime/job-events";

let dbInstance: Database | null = null;

export function initDatabase(path: string): Database {
	const db = new Database(path);
	runMigrations(db);
	dbInstance = db;
	return db;
}

export function getDatabase(): Database {
	if (!dbInstance) {
		throw new Error("Database not initialized. Call initDatabase first.");
	}
	return dbInstance;
}

function runMigrations(db: Database): void {
	db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

	const appliedVersions = db
		.query("SELECT version FROM migrations")
		.all()
		.map((row: any) => row.version);

	for (const migration of MIGRATIONS) {
		if (!appliedVersions.includes(migration.version)) {
			db.exec(migration.up);
			db.run("INSERT INTO migrations (version, name) VALUES (?, ?)", [
				migration.version,
				migration.name,
			]);
			console.log(`Applied migration ${migration.version}: ${migration.name}`);
		}
	}
}

export function insertMergeHistory(entry: {
	repo: string;
	branch: string;
	headCommit: string;
	mergeCommit: string;
	mergedAt: Date;
	ciStatus: string;
	ciLogPath: string | null;
}): void {
	const db = getDatabase();
	db.run(
		`INSERT INTO merge_history (repo, branch, head_commit, merge_commit, merged_at, ci_status, ci_log_path)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
		[
			entry.repo,
			entry.branch,
			entry.headCommit,
			entry.mergeCommit,
			entry.mergedAt.toISOString(),
			entry.ciStatus,
			entry.ciLogPath,
		],
	);
}

export function getMergeHistory(
	repo: string,
	limit: number = 100,
): MergeHistoryEntry[] {
	const db = getDatabase();
	const rows = db
		.query(
			`SELECT id, repo, branch, head_commit, merge_commit, merged_at, ci_status, ci_log_path
       FROM merge_history
       WHERE repo = ?
       ORDER BY merged_at DESC
       LIMIT ?`,
		)
		.all(repo, limit) as any[];

	return rows.map((row) => ({
		id: row.id,
		repo: row.repo,
		branch: row.branch,
		headCommit: row.head_commit,
		mergeCommit: row.merge_commit,
		mergedAt: new Date(row.merged_at),
		ciStatus: row.ci_status,
		ciLogPath: row.ci_log_path,
	}));
}

export function insertCIJob(job: {
	repo: string;
	branch: string;
	headCommit: string;
	status: string;
	logPath: string;
	startedAt: Date;
}): number {
	const db = getDatabase();
	const result = db.run(
		`INSERT INTO ci_jobs (repo, branch, head_commit, status, log_path, started_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
		[
			job.repo,
			job.branch,
			job.headCommit,
			job.status,
			job.logPath,
			job.startedAt.toISOString(),
		],
	);
	const id = Number(result.lastInsertRowid);
	broadcastJobEvent({
		id,
		repo: job.repo,
		branch: job.branch,
		headCommit: job.headCommit,
		status: job.status,
		exitCode: null,
		startedAt: job.startedAt.toISOString(),
		finishedAt: null,
	});
	return id;
}

export function updateCIJob(
	id: number,
	updates: {
		status?: string;
		finishedAt?: Date;
		exitCode?: number;
	},
): void {
	const db = getDatabase();
	const fields: string[] = [];
	const values: any[] = [];

	if (updates.status) {
		fields.push("status = ?");
		values.push(updates.status);
	}
	if (updates.finishedAt) {
		fields.push("finished_at = ?");
		values.push(updates.finishedAt.toISOString());
	}
	if (updates.exitCode !== undefined) {
		fields.push("exit_code = ?");
		values.push(updates.exitCode);
	}

	if (fields.length > 0) {
		values.push(id);
		db.run(`UPDATE ci_jobs SET ${fields.join(", ")} WHERE id = ?`, values);
	}

	const updated = getCIJob(id);
	if (updated) {
		broadcastJobEvent(ciJobToEvent(updated));
	}
}

export function getCIJob(id: number): CIJob | null {
	const db = getDatabase();
	const row = db.query("SELECT * FROM ci_jobs WHERE id = ?").get(id) as any;

	if (!row) {
		return null;
	}

	return {
		id: row.id,
		repo: row.repo,
		branch: row.branch,
		headCommit: row.head_commit,
		status: row.status,
		logPath: row.log_path,
		startedAt: new Date(row.started_at),
		finishedAt: row.finished_at ? new Date(row.finished_at) : null,
		exitCode: row.exit_code,
	};
}

export function listCIJobs(limit: number = 100): CIJob[] {
	const db = getDatabase();
	const rows = db
		.query(
			`SELECT * FROM ci_jobs
       ORDER BY 
         CASE WHEN status = 'running' THEN 0 ELSE 1 END,
         started_at DESC
       LIMIT ?`,
		)
		.all(limit) as any[];

	return rows.map((row) => ({
		id: row.id,
		repo: row.repo,
		branch: row.branch,
		headCommit: row.head_commit,
		status: row.status,
		logPath: row.log_path,
		startedAt: new Date(row.started_at),
		finishedAt: row.finished_at ? new Date(row.finished_at) : null,
		exitCode: row.exit_code,
	}));
}

export function getLatestCIJob(
	repo: string,
	branch: string,
	headCommit: string,
): CIJob | null {
	const db = getDatabase();
	const row = db
		.query(
			`SELECT * FROM ci_jobs
       WHERE repo = ? AND branch = ? AND head_commit = ?
       ORDER BY started_at DESC
       LIMIT 1`,
		)
		.get(repo, branch, headCommit) as any;

	if (!row) {
		return null;
	}

	return {
		id: row.id,
		repo: row.repo,
		branch: row.branch,
		headCommit: row.head_commit,
		status: row.status,
		logPath: row.log_path,
		startedAt: new Date(row.started_at),
		finishedAt: row.finished_at ? new Date(row.finished_at) : null,
		exitCode: row.exit_code,
	};
}

export function cancelPendingJobs(
	repo: string,
	branch: string,
	exceptJobId?: number,
): void {
	const db = getDatabase();
	const pendingQuery = db.query(
		`SELECT id, repo, branch, head_commit, started_at 
     FROM ci_jobs 
     WHERE repo = ? AND branch = ? AND status = 'pending' ${exceptJobId ? "AND id != ?" : ""}`,
	);
	const pendingJobs = pendingQuery.all(
		...(exceptJobId ? [repo, branch, exceptJobId] : [repo, branch]),
	) as any[];

	const where = exceptJobId
		? "repo = ? AND branch = ? AND status = ? AND id != ?"
		: "repo = ? AND branch = ? AND status = ?";
	const params = exceptJobId
		? [repo, branch, "pending", exceptJobId]
		: [repo, branch, "pending"];

	db.run(`UPDATE ci_jobs SET status = 'canceled' WHERE ${where}`, params);

	for (const entry of pendingJobs) {
		broadcastJobEvent({
			id: entry.id,
			repo: entry.repo,
			branch: entry.branch,
			headCommit: entry.head_commit,
			status: "canceled",
			exitCode: null,
			startedAt: entry.started_at,
			finishedAt: null,
		});
	}
}

export function registerPreview(
	subdomain: string,
	repo: string,
	branch: string,
	port: number,
): void {
	const db = getDatabase();
	db.run(
		`INSERT OR REPLACE INTO preview_deployments (subdomain, repo, branch, port, created_at)
     VALUES (?, ?, ?, ?, ?)`,
		[subdomain, repo, branch, port, new Date().toISOString()],
	);
}

export function getPreviewBySubdomain(
	subdomain: string,
): { port: number; repo: string; branch: string } | null {
	const db = getDatabase();
	const row = db
		.query(
			"SELECT port, repo, branch FROM preview_deployments WHERE subdomain = ?",
		)
		.get(subdomain) as any;

	return row ? { port: row.port, repo: row.repo, branch: row.branch } : null;
}

export function getPreviewByBranch(
	repo: string,
	branch: string,
): { subdomain: string; port: number } | null {
	const db = getDatabase();
	const row = db
		.query(
			"SELECT subdomain, port FROM preview_deployments WHERE repo = ? AND branch = ?",
		)
		.get(repo, branch) as any;

	return row ? { subdomain: row.subdomain, port: row.port } : null;
}

export function deletePreview(repo: string, branch: string): void {
	const db = getDatabase();
	db.run("DELETE FROM preview_deployments WHERE repo = ? AND branch = ?", [
		repo,
		branch,
	]);
}

function ciJobToEvent(job: CIJob): JobEventPayload {
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
