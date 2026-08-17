import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--host-resolver-rules=MAP adexto.xyz 168.144.249.185, MAP *.adexto.xyz 168.144.249.185']
  });

  const routes = [
    '/',
    '/studio',
    '/swap',
    '/governance',
    '/explorer',
    '/agent/demo',
    '/pitch',
    '/whitepaper',
    '/docs',
  ];

  console.log('=== RUNNING DEEP PLAYWRIGHT AUDIT ACROSS ALL PAGES ===\n');

  for (const r of routes) {
    // 1. Desktop Check
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = [];
    const brokenImages = [];

    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', err => errors.push(err.message));

    const res = await page.goto(`http://localhost:3000${r}`, { waitUntil: 'networkidle' });
    
    // Check broken images
    const images = await page.locator('img').all();
    for (const img of images) {
      const src = await img.getAttribute('src');
      const isLoaded = await img.evaluate((node) => node.complete && node.naturalWidth > 0);
      if (!isLoaded) {
        brokenImages.push(src);
      }
    }

    // Check horizontal overflow (meleber)
    const hasHorizontalScroll = await page.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth;
    });

    console.log(`[DESKTOP] ${r}`);
    console.log(`  - HTTP Status: ${res?.status()}`);
    console.log(`  - Console Errors: ${errors.length ? errors.join('; ') : 'None'}`);
    console.log(`  - Broken Images: ${brokenImages.length ? brokenImages.join(', ') : 'None'}`);
    console.log(`  - Horizontal Overflow: ${hasHorizontalScroll ? '⚠️ YES (OVERFLOWING)' : '✓ None'}`);

    // Take screenshot for visual inspection
    const cleanRouteName = r === '/' ? 'home' : r.replace(/\//g, '_');
    await page.screenshot({ path: `/tmp/opencode/audit_deep_desktop_${cleanRouteName}.png`, fullPage: true });

    await page.close();

    // 2. Mobile Check (375x812)
    const mobilePage = await browser.newPage({
      viewport: { width: 375, height: 812 },
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15'
    });
    const mobileErrors = [];
    const mobileBrokenImages = [];

    mobilePage.on('console', msg => {
      if (msg.type() === 'error') mobileErrors.push(msg.text());
    });
    mobilePage.on('pageerror', err => mobileErrors.push(err.message));

    const mRes = await mobilePage.goto(`http://localhost:3000${r}`, { waitUntil: 'networkidle' });

    const mImages = await mobilePage.locator('img').all();
    for (const img of mImages) {
      const src = await img.getAttribute('src');
      const isLoaded = await img.evaluate((node) => node.complete && node.naturalWidth > 0);
      if (!isLoaded) {
        mobileBrokenImages.push(src);
      }
    }

    const mHasHorizontalScroll = await mobilePage.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth;
    });

    console.log(`[MOBILE] ${r}`);
    console.log(`  - HTTP Status: ${mRes?.status()}`);
    console.log(`  - Console Errors: ${mobileErrors.length ? mobileErrors.join('; ') : 'None'}`);
    console.log(`  - Broken Images: ${mobileBrokenImages.length ? mobileBrokenImages.join(', ') : 'None'}`);
    console.log(`  - Horizontal Overflow: ${mHasHorizontalScroll ? '⚠️ YES (OVERFLOWING)' : '✓ None'}`);
    console.log('--------------------------------------------------');

    await mobilePage.screenshot({ path: `/tmp/opencode/audit_deep_mobile_${cleanRouteName}.png`, fullPage: true });
    await mobilePage.close();
  }

  await browser.close();
  console.log('\n=== AUDIT COMPLETE ===');
})();
