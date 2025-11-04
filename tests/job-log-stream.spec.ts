import { expect, test } from "@playwright/test";

test("streams CI log updates without reload", async ({ page, request }) => {
	const repoName = `stream-repo-${Date.now()}`;

	const createResponse = await request.post("/__test__/jobs", {
		data: {
			repo: repoName,
			branch: "feature/log-stream",
			log: "Booting CI job...\n",
			status: "running",
		},
	});

	expect(createResponse.ok()).toBeTruthy();
	const { jobId } = await createResponse.json();
	expect(jobId).toBeTruthy();

	await page.goto(`/jobs/${jobId}`);

	const logPre = page.locator("#job-log-pre");
	await expect(logPre).toContainText("Booting CI job...");

	const appendResponse = await request.post(`/__test__/jobs/${jobId}/log`, {
		data: { chunk: "Streaming log line 1\n" },
	});
	expect(appendResponse.ok()).toBeTruthy();

	await expect(logPre).toContainText("Streaming log line 1", {
		timeout: 15000,
	});

	await request.post(`/__test__/jobs/${jobId}/log`, {
		data: { chunk: "Streaming log line 2\n" },
	});

	await expect(logPre).toContainText("Streaming log line 2", {
		timeout: 15000,
	});

	const finishResponse = await request.post(`/__test__/jobs/${jobId}/finish`, {
		data: { status: "passed", exitCode: 0 },
	});
	expect(finishResponse.ok()).toBeTruthy();
});
