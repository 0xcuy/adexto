import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  const errors = [];
  page.on('console', msg => console.log(`[CONSOLE ${msg.type()}]:`, msg.text()));
  page.on('pageerror', err => console.log('[PAGE ERROR]:', err));

  console.log('Navigating to http://localhost:3000/token/aegis ...');
  await page.goto('http://localhost:3000/token/aegis', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  // Check if canvas elements exist
  const canvasCount = await page.locator('canvas').count();
  console.log('Canvas elements count inside chart:', canvasCount);

  const chartBox = await page.locator('.tv-lightweight-charts, canvas').all();
  console.log('Lightweight chart elements found:', chartBox.length);

  await page.screenshot({ path: '/tmp/opencode/debug_chart_render.png', fullPage: true });
  console.log('Screenshot saved to /tmp/opencode/debug_chart_render.png');

  await browser.close();
})();
