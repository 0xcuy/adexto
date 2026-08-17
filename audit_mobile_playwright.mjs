import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: true });
  
  // Mobile Viewport (iPhone 14 / Standard 375x812)
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15'
  });
  const page = await context.newPage();

  const routes = [
    { name: 'mobile_home', url: 'http://localhost:3000/' },
    { name: 'mobile_studio', url: 'http://localhost:3000/studio' },
    { name: 'mobile_swap', url: 'http://localhost:3000/swap' },
    { name: 'mobile_governance', url: 'http://localhost:3000/governance' },
    { name: 'mobile_explorer', url: 'http://localhost:3000/explorer' },
    { name: 'mobile_pitch', url: 'http://localhost:3000/pitch' },
  ];

  for (const r of routes) {
    console.log(`Auditing mobile: ${r.name} (${r.url})...`);
    await page.goto(r.url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `/tmp/opencode/audit_${r.name}.png`, fullPage: true });
    console.log(`✓ Saved /tmp/opencode/audit_${r.name}.png`);
  }

  await browser.close();
})();
