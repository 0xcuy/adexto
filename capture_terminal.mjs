import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  console.log('Capturing screenshot of http://localhost:3000/token/aegis ...');
  await page.goto('http://localhost:3000/token/aegis', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: '/tmp/opencode/live_terminal_check.png', fullPage: true });
  console.log('Saved /tmp/opencode/live_terminal_check.png');

  await browser.close();
})();
