import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--host-resolver-rules=MAP adexto.xyz 168.144.249.185, MAP *.adexto.xyz 168.144.249.185']
  });
  const page = await browser.newPage();

  console.log('1. Auditing /explorer for direct edge links & Arbiscan...');
  await page.goto('https://adexto.xyz/explorer', { waitUntil: 'networkidle' });
  await page.screenshot({ path: '/tmp/opencode/audit_explorer_fixed_links.png', fullPage: true });

  console.log('2. Auditing /studio for Arbitrum One (Live) in dropdown...');
  await page.goto('https://adexto.xyz/studio', { waitUntil: 'networkidle' });
  await page.screenshot({ path: '/tmp/opencode/audit_studio_fixed_chain.png', fullPage: true });

  await browser.close();
  console.log('✓ AUDIT COMPLETED.');
})();
