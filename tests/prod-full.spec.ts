import { test, expect } from '@playwright/test';

test('forge production - full smoke test', async ({ page }) => {
  // Home page
  await page.goto('https://forge.justinmoon.com');
  await expect(page).toHaveTitle(/Repositories.*forge/);
  
  // Check for test repo
  const content = await page.content();
  console.log('Repositories found:', content.includes('test-repo') ? 'test-repo' : 'none yet');
  
  // Jobs dashboard
  await page.goto('https://forge.justinmoon.com/jobs');
  await expect(page.getByText('CI Jobs')).toBeVisible();
  
  console.log('✓ Forge is fully operational!');
});
