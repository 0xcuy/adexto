import { chromium } from 'playwright';

(async () => {
  // Launch Playwright with standard Chromium and resolve rule to Cloudflare Edge Anycast IP
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--host-resolver-rules=MAP adexto.xyz 104.21.12.99, MAP *.adexto.xyz 104.21.12.99'
    ]
  });

  const page = await browser.newPage();

  console.log('>>> Testing Playwright Navigation to https://adexto.xyz ...');
  try {
    const res = await page.goto('https://adexto.xyz', { waitUntil: 'networkidle', timeout: 30000 });
    console.log('STATUS:', res.status());
    console.log('TITLE :', await page.title());
    
    // Capture full screenshot
    await page.screenshot({ path: '/tmp/opencode/live_https_adexto_xyz.png', fullPage: true });
    console.log('✓ SCREENSHOT CAPTURED: /tmp/opencode/live_https_adexto_xyz.png');

    // Also test /studio
    const resStudio = await page.goto('https://adexto.xyz/studio', { waitUntil: 'networkidle', timeout: 30000 });
    console.log('STUDIO STATUS:', resStudio.status());
    await page.screenshot({ path: '/tmp/opencode/live_https_studio.png', fullPage: true });
    console.log('✓ STUDIO SCREENSHOT: /tmp/opencode/live_https_studio.png');

    // Also test /swap
    const resSwap = await page.goto('https://adexto.xyz/swap', { waitUntil: 'networkidle', timeout: 30000 });
    console.log('SWAP STATUS:', resSwap.status());
    await page.screenshot({ path: '/tmp/opencode/live_https_swap.png', fullPage: true });
    console.log('✓ SWAP SCREENSHOT: /tmp/opencode/live_https_swap.png');

  } catch (err) {
    console.error('ERROR:', err);
  } finally {
    await browser.close();
  }
})();
