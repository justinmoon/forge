import { test, expect } from '@playwright/test';

const PROD_URL = 'https://forge.justinmoon.com';

test('forge production - verify deployment', async ({ page }) => {
  // 1. Homepage loads
  await page.goto(PROD_URL);
  await expect(page.getByText('test-repo')).toBeVisible();
  console.log('✓ Homepage loads with repositories');

  // 2. Jobs dashboard
  await page.goto(`${PROD_URL}/jobs`);
  await expect(page.getByRole('heading', { name: 'CI Jobs' })).toBeVisible();
  console.log('✓ Jobs dashboard accessible');

  // 3. Repository page
  await page.goto(`${PROD_URL}/r/test-repo`);
  const content = await page.content();
  console.log('✓ Repository page loads');

  // 4. Merge history shows completed merges
  await page.goto(`${PROD_URL}/r/test-repo/history`);
  await expect(page.getByText('feature-branch')).toBeVisible();
  await expect(page.getByText('CI passed')).toBeVisible();
  console.log('✓ Merge history shows successful merges');

  console.log('\n✅ Production deployment verified!');
});
