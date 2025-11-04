import { defineConfig, devices } from "@playwright/test";
const sharedUse = {
	baseURL: "http://localhost:3030",
	trace: "on-first-retry",
};
const chromiumExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
const chromiumDevice = { ...devices["Desktop Chrome"] };
if (chromiumExecutable) {
	chromiumDevice.launchOptions = {
		...(chromiumDevice.launchOptions ?? {}),
		executablePath: chromiumExecutable,
	};
}

export default defineConfig({
	testDir: "./tests",
	testMatch: ["**/job-log-stream.spec.ts", "**/realtime-ui.spec.ts"],
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: process.env.CI ? 1 : undefined,
	reporter: "line",
	use: sharedUse,
	projects: [
		{
			name: "chromium",
			use: chromiumDevice,
		},
	],
	webServer: {
		command: "bun run src/index.ts",
		url: "http://localhost:3030",
		reuseExistingServer: !process.env.CI,
		timeout: 10000,
		env: {
			FORGE_DATA_DIR: ".forge-e2e",
			FORGE_PORT: "3030",
			FORGE_MERGE_PASSWORD: "test-password",
			NODE_ENV: "test",
		},
	},
});
