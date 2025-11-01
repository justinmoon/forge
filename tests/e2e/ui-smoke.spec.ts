import { test, expect } from '@playwright/test';

// UI smoke tests - placeholder for future browser-based testing
// TODO: Fix webServer configuration to properly start forge with test data

test.skip('UI smoke test - verify key pages load', async ({ page }) => {
  // Skipped until webServer config issue is resolved
  // This test infrastructure is in place for future e2e testing
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveTitle(/forge/);
});
