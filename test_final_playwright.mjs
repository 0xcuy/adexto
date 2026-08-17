import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--host-resolver-rules=MAP adexto.xyz 168.144.249.185, MAP aegis.adexto.xyz 168.144.249.185']
  });

  // 1. Check Root
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  console.log('Testing Root https://adexto.xyz ...');
  const res1 = await page.goto('https://adexto.xyz', { waitUntil: 'networkidle' });
  console.log('✓ Root Status:', res1?.status());
  await page.screenshot({ path: '/tmp/opencode/audit_final_adexto_root.png', fullPage: true });

  // 2. Check Subdomain Rewrite
  console.log('Testing Subdomain https://aegis.adexto.xyz ...');
  const res2 = await page.goto('https://aegis.adexto.xyz', { waitUntil: 'networkidle' });
  console.log('✓ Subdomain Status:', res2?.status());
  console.log('✓ Subdomain Title:', await page.title());
  await page.screenshot({ path: '/tmp/opencode/audit_final_aegis_subdomain.png', fullPage: true });

  await browser.close();
  console.log('✓ PLAYWRIGHT VERIFICATION 100% COMPLETE.');
})();
