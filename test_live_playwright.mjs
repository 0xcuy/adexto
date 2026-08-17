import { chromium } from 'playwright';

(async () => {
  // Launch chromium with custom DNS resolver pointing directly to 1.1.1.1 or IP mapping
  const browser = await chromium.launch({
    headless: true,
    args: ['--host-resolver-rules=MAP adexto.xyz 168.144.249.185, MAP *.adexto.xyz 168.144.249.185']
  });
  const page = await browser.newPage();

  console.log('Testing Playwright navigation to https://adexto.xyz (Direct Host-Mapping)...');
  try {
    const response = await page.goto('https://adexto.xyz', { waitUntil: 'networkidle', timeout: 30000 });
    console.log('✓ Status Code:', response?.status());
    console.log('✓ Page Title :', await page.title());
    await page.screenshot({ path: '/tmp/opencode/live_adexto_xyz_success.png', fullPage: true });
    console.log('✓ SUCCESS: Screenshot saved to /tmp/opencode/live_adexto_xyz_success.png');
  } catch (err) {
    console.error('✗ Navigation failed:', err.message);
  } finally {
    await browser.close();
  }
})();
