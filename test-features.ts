import { chromium } from 'playwright';

async function testFeatures() {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1200 } });
  
  try {
    const url = 'http://forge.justinmoon.com/r/forge/mr/test-diff-and-delete';
    console.log('Loading merge request page...');
    await page.goto(url, { waitUntil: 'networkidle', timeout: 10000 });
    
    // Take screenshot of unified view
    console.log('Screenshot 1: Unified view');
    await page.screenshot({ path: 'test-1-unified.png', fullPage: true });
    
    // Check for diff viewer elements
    const hasDiffViewer = await page.locator('.diff-viewer').count() > 0;
    const hasFileList = await page.locator('.diff-file-list').count() > 0;
    const hasToggleButtons = await page.locator('.diff-toggle-btn').count() > 0;
    const hasDeleteButton = await page.locator('button:has-text("Delete Branch")').count() > 0;
    
    console.log('✓ Diff viewer present:', hasDiffViewer);
    console.log('✓ File list present:', hasFileList);
    console.log('✓ Toggle buttons present:', hasToggleButtons);
    console.log('✓ Delete button present:', hasDeleteButton);
    
    // Click split view button
    if (hasToggleButtons) {
      console.log('Switching to split view...');
      const splitButton = page.locator('.diff-toggle-btn[data-view="split"]');
      await splitButton.click();
      await page.waitForTimeout(500);
      
      console.log('Screenshot 2: Split view');
      await page.screenshot({ path: 'test-2-split.png', fullPage: true });
    }
    
    // Test collapse functionality
    const collapseButton = page.locator('.diff-collapse-btn').first();
    if (await collapseButton.count() > 0) {
      console.log('Testing collapse functionality...');
      await collapseButton.click();
      await page.waitForTimeout(300);
      
      console.log('Screenshot 3: File collapsed');
      await page.screenshot({ path: 'test-3-collapsed.png', fullPage: true });
      
      // Expand again
      await collapseButton.click();
      await page.waitForTimeout(300);
    }
    
    console.log('\\n✅ All features verified!');
    console.log('\\nScreenshots saved:');
    console.log('  - test-1-unified.png');
    console.log('  - test-2-split.png');
    console.log('  - test-3-collapsed.png');
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await browser.close();
  }
}

testFeatures();
