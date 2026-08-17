import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--host-resolver-rules=MAP adexto.xyz 168.144.249.185, MAP *.adexto.xyz 168.144.249.185']
  });

  const page = await browser.newPage({
    viewport: { width: 375, height: 812 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15'
  });

  await page.goto('https://adexto.xyz/explorer', { waitUntil: 'networkidle' });

  // Find elements wider than 375px
  const wideElements = await page.evaluate(() => {
    const docWidth = document.documentElement.clientWidth;
    const elements = document.querySelectorAll('*');
    const overflowing = [];
    elements.forEach(el => {
      const rect = el.getBoundingClientRect();
      if (rect.right > docWidth || rect.width > docWidth) {
        overflowing.push({
          tag: el.tagName,
          className: el.className,
          width: rect.width,
          right: rect.right,
          text: (el.textContent || '').slice(0, 50).trim()
        });
      }
    });
    return overflowing.slice(0, 10);
  });

  console.log('Overflowing Elements on /explorer:', JSON.stringify(wideElements, null, 2));

  await browser.close();
})();
