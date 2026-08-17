import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--host-resolver-rules=MAP adexto.xyz 168.144.249.185, MAP *.adexto.xyz 168.144.249.185']
  });
  const page = await browser.newPage();

  console.log('1. Auditing /explorer for Image & Deduplication...');
  await page.goto('https://adexto.xyz/explorer', { waitUntil: 'networkidle' });
  await page.screenshot({ path: '/tmp/opencode/audit_explorer_final.png', fullPage: true });

  console.log('2. Auditing /swap for Target Token Logo...');
  await page.goto('https://adexto.xyz/swap', { waitUntil: 'networkidle' });
  await page.screenshot({ path: '/tmp/opencode/audit_swap_final.png', fullPage: true });

  await browser.close();
  console.log('✓ AUDIT FINISHED.');
})();
