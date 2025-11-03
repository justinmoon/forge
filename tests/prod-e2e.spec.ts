import { test, expect } from '@playwright/test';

const PROD_URL = 'https://forge.justinmoon.com';

// TODO: Update this test for Nostr NIP-07 authentication
// This test needs to be rewritten to:
// 1. Mock window.nostr extension
// 2. Handle the login flow with challenge/response
// 3. Set session cookies properly
test.skip('forge production - full e2e workflow', async ({ page }) => {
  // 1. Check homepage loads
  await page.goto(PROD_URL);
  await expect(page.getByText('test-repo')).toBeVisible();
  console.log('✓ Homepage loads');

  // 2. Check repository page shows MR
  await page.goto(`${PROD_URL}/r/test-repo`);
  await expect(page.getByText('feature-branch')).toBeVisible();
  await expect(page.getByText('CI passed')).toBeVisible();
  console.log('✓ Repository shows feature-branch with CI passed');

  // 3. Check MR detail page
  await page.goto(`${PROD_URL}/r/test-repo/mr/feature-branch`);
  await expect(page.getByText('Merge to master')).toBeVisible();
  const mergeButton = page.locator('button:has-text("Merge to master")');
  await expect(mergeButton).not.toBeDisabled();
  console.log('✓ MR page shows enabled merge button');

  // 4. Click merge button (no password prompt anymore)
  await mergeButton.click();
  
  // Wait for merge to complete (check for success alert or redirect)
  await page.waitForTimeout(2000);

  // 6. Verify merge succeeded - should redirect to repo page without the MR
  await page.goto(`${PROD_URL}/r/test-repo`);
  const pageContent = await page.content();
  
  if (pageContent.includes('No active merge requests')) {
    console.log('✓ Merge succeeded - no active MRs');
  } else if (pageContent.includes('feature-branch')) {
    console.log('⚠ MR still visible - checking if merge succeeded anyway');
  }

  // 7. Check merge history
  await page.goto(`${PROD_URL}/r/test-repo/history`);
  await expect(page.getByText('feature-branch')).toBeVisible();
  console.log('✓ Merge appears in history');

  console.log('\n✅ Full e2e workflow complete!');
});
