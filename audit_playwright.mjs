import { chromium } from 'playwright';

const pages = [
  { name: '01_desktop_home', url: 'http://localhost:3000/', viewport: { width: 1280, height: 800 } },
  { name: '02_desktop_studio_locked', url: 'http://localhost:3000/studio', viewport: { width: 1280, height: 800 } },
  { name: '03_desktop_swap', url: 'http://localhost:3000/swap', viewport: { width: 1280, height: 800 } },
  { name: '04_desktop_governance', url: 'http://localhost:3000/governance', viewport: { width: 1280, height: 800 } },
  { name: '05_desktop_explorer', url: 'http://localhost:3000/explorer', viewport: { width: 1280, height: 800 } },
  { name: '06_desktop_agent_demo', url: 'http://localhost:3000/agent/demo', viewport: { width: 1280, height: 800 } },
  { name: '07_desktop_pitch', url: 'http://localhost:3000/pitch', viewport: { width: 1280, height: 800 } },
  { name: '08_desktop_whitepaper', url: 'http://localhost:3000/whitepaper', viewport: { width: 1280, height: 800 } },
  { name: '09_desktop_docs', url: 'http://localhost:3000/docs', viewport: { width: 1280, height: 800 } },
  { name: '10_mobile_home', url: 'http://localhost:3000/', viewport: { width: 375, height: 667 } },
  { name: '11_mobile_governance', url: 'http://localhost:3000/governance', viewport: { width: 375, height: 667 } },
];

(async () => {
  const browser = await chromium.launch({ headless: true });
  const errors = [];

  for (const p of pages) {
    const context = await browser.newContext({ viewport: p.viewport });
    const page = await context.newPage();
    
    page.on('console', msg => {
      if (msg.type() === 'error') {
        // Exclude third party or favicon/font 400 telemetry if any
        errors.push(`[${p.name}] Console Error: ${msg.text()}`);
      }
    });
    page.on('pageerror', err => {
      errors.push(`[${p.name}] Page Error: ${err.message}`);
    });
    
    page.on('response', response => {
      if (response.status() >= 400 && response.url().includes('localhost')) {
        console.log(`[HTTP ${response.status()}] ${response.url()}`);
      }
    });

    const start = Date.now();
    const res = await page.goto(p.url, { waitUntil: 'networkidle' });
    const duration = Date.now() - start;

    console.log(`✓ ${p.name} | Status: ${res.status()} | Time: ${duration}ms`);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `/tmp/opencode/audit_${p.name}.png`, fullPage: true });
    await context.close();
  }

  await browser.close();

  if (errors.length > 0) {
    console.log('Errors found:', errors);
  } else {
    console.log('✓ Zero console/page runtime errors across all routes.');
  }
})();
