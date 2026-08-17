import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--host-rules=MAP aegis.adexto.xyz 127.0.0.1']
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  console.log('Testing custom subdomain routing (http://aegis.adexto.xyz:3000)...');
  await page.goto('http://aegis.adexto.xyz:3000', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  console.log('Page Title on aegis.adexto.xyz:', await page.title());
  await page.screenshot({ path: '/tmp/opencode/live_subdomain_aegis.png', fullPage: true });
  console.log('✓ Screenshot saved to /tmp/opencode/live_subdomain_aegis.png');

  await browser.close();
})();
