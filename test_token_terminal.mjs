import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  console.log('Testing /token/aegis Token Terminal...');
  await page.goto('http://localhost:3000/token/aegis', { waitUntil: 'networkidle' });
  await page.screenshot({ path: '/tmp/opencode/audit_token_terminal_aegis.png', fullPage: true });

  console.log('Testing /token/qnova Token Terminal...');
  await page.goto('http://localhost:3000/token/qnova', { waitUntil: 'networkidle' });
  await page.screenshot({ path: '/tmp/opencode/audit_token_terminal_qnova.png', fullPage: true });

  await browser.close();
  console.log('✓ Token Terminal Screenshots Captured!');
})();
