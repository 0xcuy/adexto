import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('http://localhost:3000/explorer', { waitUntil: 'networkidle' });

  console.log('Testing category filters...');
  const catButtons = ['DEFI', 'TRADING', 'SECURITY'];
  for (const cat of catButtons) {
    const btn = page.locator(`button:has-text("${cat}")`);
    await btn.click();
    await page.waitForTimeout(300);
    const count = await page.locator('.glass-panel.p-6.rounded-2xl').count();
    console.log(`✓ Category Tab [${cat}] -> Showing ${count} project cards`);
  }

  console.log('\nTesting chain filters...');
  // Click All category first to reset
  await page.locator('button:has-text("ALL")').first().click();
  await page.waitForTimeout(300);

  const chainButtons = ['0G', 'ARBITRUM'];
  for (const c of chainButtons) {
    const btn = page.locator(`button:has-text("${c}")`).nth(0);
    await btn.click();
    await page.waitForTimeout(300);
    const count = await page.locator('.glass-panel.p-6.rounded-2xl').count();
    console.log(`✓ Chain Filter [${c}] -> Showing ${count} project cards`);
  }

  await browser.close();
})();
