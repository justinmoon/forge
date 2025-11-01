import { test, expect } from '@playwright/test';

// Production smoke test
// Run with: bunx playwright test tests/prod-smoke.spec.ts

test('forge production - home page loads', async ({ page }) => {
  const response = await page.goto('https://forge.justinmoon.com', {
    waitUntil: 'domcontentloaded',
    timeout: 10000
  });
  
  console.log('Response status:', response?.status());
  const content = await page.content();
  console.log('Content preview:', content.slice(0, 200));
  
  expect(response?.status()).toBeLessThan(500);
});
