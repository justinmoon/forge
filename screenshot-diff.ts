import { chromium } from 'playwright';

async function takeScreenshots() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 1200 } });
  
  try {
    console.log('Loading merge request page...');
    await page.goto('http://forge.justinmoon.com/r/forge/mr/test-diff-viewer', { 
      waitUntil: 'networkidle',
      timeout: 10000 
    });
    
    console.log('Taking screenshot of unified view...');
    await page.screenshot({ path: 'screenshot-unified.png', fullPage: true });
    
    console.log('Clicking split view button...');
    const splitButton = page.locator('.diff-toggle-btn[data-view="split"]');
    if (await splitButton.count() > 0) {
      await splitButton.click();
      await page.waitForTimeout(500);
    } else {
      console.log('Split button not found');
    }
    
    console.log('Taking screenshot of split view...');
    await page.screenshot({ path: 'screenshot-split.png', fullPage: true });
    
    console.log('Screenshots saved!');
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await browser.close();
  }
}

takeScreenshots();
