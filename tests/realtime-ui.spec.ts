import { execSync } from "node:child_process";
import {
	appendFileSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "@playwright/test";

function setupRepository(
	repoName: string,
	featureBranch: string,
): { headCommit: string; cleanup: () => void } {
	const dataDir = resolve(".forge-e2e");
	const reposDir = join(dataDir, "repos");
	mkdirSync(reposDir, { recursive: true });

	const barePath = join(reposDir, `${repoName}.git`);
	execSync(`git init --bare "${barePath}"`, { stdio: "pipe" });

	const tempDir = mkdtempSync(join(tmpdir(), "forge-playwright-"));
	const workDir = join(tempDir, "work");

	execSync(`git clone "${barePath}" "${workDir}"`, { stdio: "pipe" });
	execSync('git config user.name "Playwright Tester"', {
		cwd: workDir,
		stdio: "pipe",
	});
	execSync('git config user.email "playwright@example.com"', {
		cwd: workDir,
		stdio: "pipe",
	});

	writeFileSync(join(workDir, "README.md"), "# Forge E2E\n");
	execSync("git add README.md", { cwd: workDir, stdio: "pipe" });
	execSync('git commit -m "chore: initial commit"', {
		cwd: workDir,
		stdio: "pipe",
	});
	execSync("git push origin master", { cwd: workDir, stdio: "pipe" });

	execSync(`git checkout -b ${featureBranch}`, { cwd: workDir, stdio: "pipe" });
	appendFileSync(join(workDir, "README.md"), "\nRealtime update\n");
	execSync("git add README.md", { cwd: workDir, stdio: "pipe" });
	execSync('git commit -m "feat: realtime branch"', {
		cwd: workDir,
		stdio: "pipe",
	});
	const headCommit = execSync("git rev-parse HEAD", {
		cwd: workDir,
		stdio: "pipe",
	})
		.toString()
		.trim();
	execSync(`git push origin ${featureBranch}`, { cwd: workDir, stdio: "pipe" });

	return {
		headCommit,
		cleanup: () => {
			rmSync(tempDir, { recursive: true, force: true });
		},
	};
}

test("realtime UI updates propagate across forge surfaces", async ({
	page,
	request,
}) => {
	const repoName = `realtime-e2e-${Date.now()}`;
	const featureBranch = "feature-realtime";
	const { headCommit, cleanup } = setupRepository(repoName, featureBranch);

	try {
		await page.goto("/");
		const jobTray = page.locator("#job-tray");
		await expect(jobTray).not.toContainText(repoName);

		const createJobResponse = await request.post("/__test__/jobs", {
			data: {
				repo: repoName,
				branch: featureBranch,
				headCommit,
				status: "running",
				log: "Booting CI job...\n",
			},
		});
		expect(createJobResponse.ok()).toBeTruthy();
		const { jobId } = (await createJobResponse.json()) as { jobId: number };

		await expect(jobTray).not.toHaveClass(/hidden/);
		await expect(jobTray).toContainText(`Job #${jobId}`);
		await expect(jobTray).toContainText(`${repoName}/${featureBranch}`);

		await page.goto("/jobs");
		const runningJobCard = page.locator(
			`[data-job-list="running"] [data-job-id="${jobId}"]`,
		);
		await expect(runningJobCard).toBeVisible();
		await expect(runningJobCard).toContainText(/running/i);

		const finishJobResponse = await request.post(
			`/__test__/jobs/${jobId}/finish`,
			{
				data: { status: "passed", exitCode: 0 },
			},
		);
		expect(finishJobResponse.ok()).toBeTruthy();

		await expect(
			page.locator(`[data-job-list="running"] [data-job-id="${jobId}"]`),
		).toHaveCount(0);

		const historyJobCard = page.locator(
			`[data-job-list="history"] [data-job-id="${jobId}"]`,
		);
		await expect(historyJobCard).toBeVisible();
		await expect(historyJobCard).toContainText(/passed/i);

		const createSecondJob = await request.post("/__test__/jobs", {
			data: {
				repo: repoName,
				branch: featureBranch,
				headCommit,
				status: "running",
				log: "Second run\n",
			},
		});
		expect(createSecondJob.ok()).toBeTruthy();
		const { jobId: jobId2 } = (await createSecondJob.json()) as {
			jobId: number;
		};

		const runningJobCard2 = page.locator(
			`[data-job-list="running"] [data-job-id="${jobId2}"]`,
		);
		await expect(runningJobCard2).toBeVisible();

		await page.goto(`/r/${repoName}/mr/${featureBranch}`);
		const statusBadge = page.locator("[data-ci-status]");
		await expect(statusBadge).toContainText(/CI running/i);

		const mergeButton = page.locator("[data-merge-button]");
		await expect(mergeButton).toBeDisabled();
		await expect(mergeButton).toHaveText(/waiting for CI/);

		const jobLink = page.locator("[data-ci-job-link]");
		await expect(jobLink).toHaveAttribute("href", `/jobs/${jobId2}`);

		const finishSecondJob = await request.post(
			`/__test__/jobs/${jobId2}/finish`,
			{
				data: { status: "passed", exitCode: 0 },
			},
		);
		expect(finishSecondJob.ok()).toBeTruthy();

		await expect(statusBadge).toContainText(/CI passed/i);
		await expect(mergeButton).toBeEnabled();
		await expect(mergeButton).toHaveText("Merge to master");
	} finally {
		await request
			.post(`/r/${repoName}/delete`, {
				form: { confirm: repoName },
			})
			.catch(() => {});
		cleanup();
	}
});
