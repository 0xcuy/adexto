import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({
    headless: true,
  });
  const page = await browser.newPage();
  await page.goto('http://localhost:3000/explorer', { waitUntil: 'networkidle' });

  console.log('Clicking TRADING tab in Explorer (Localhost)...');
  const tradingTab = page.locator('button:has-text("TRADING")');
  await tradingTab.click();
  await page.waitForTimeout(500);

  const cardCount = await page.locator('.glass-panel.p-6.rounded-2xl').count();
  console.log('Cards found in Trading tab:', cardCount);
  await page.screenshot({ path: '/tmp/opencode/audit_explorer_trading_tab_local.png', fullPage: true });

  await browser.close();
})();
