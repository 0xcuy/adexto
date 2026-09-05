import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--host-resolver-rules=MAP adexto.xyz 168.144.249.185, MAP *.adexto.xyz 168.144.249.185']
  });
  const context = await browser.newContext();
  
  // Pre-seed connected wallet in localStorage
  await context.addInitScript(() => {
    localStorage.setItem('adexto_wallet_address', '0x8a3c7524Aaed081825aC88eC7f4cCECFc583ee7D');
    localStorage.setItem('adexto_selected_chain', '0G');
  });

  const page = await context.newPage();

  console.log('1. Navigating to Studio with Connected 0G Wallet...');
  await page.goto('https://adexto.xyz/studio', { waitUntil: 'networkidle' });

  // Langkah World ID dihapus: gerbangnya dicabut, tombolnya tidak ada, dan
  // `verifyBtn.click()` akan menggantung sampai timeout.
  //
  // PERINGATAN: sisa berkas ini pun sudah relik. Ia masih mencari "Deploy Selected"
  // dan "Deployment Succeeded", dua string yang dicabut waktu klaim palsu dibersihkan,
  // jadi jangan pakai ini sebagai bukti apa pun. Yang hidup: record_demo_testnet.mjs
  // untuk rekaman dan audit_claims.mjs untuk pemeriksaan copy.

  console.log('3. Triggering 1-Click Deploy on 0G Mainnet...');
  const deployBtn = page.locator('button:has-text("Deploy Selected")');
  await deployBtn.click();

  console.log('4. Waiting for 0G DA Storage upload & TEE enclave binding...');
  await page.waitForTimeout(4500);

  const successHeader = page.locator('text=Deployment Succeeded');
  const isSuccess = await successHeader.isVisible();
  console.log('5. Deployment Result Visible:', isSuccess);

  if (isSuccess) {
    await page.screenshot({ path: '/tmp/opencode/studio_dry_run_success.png', fullPage: true });
    console.log('✓ SUCCESS SCREENSHOT CAPTURED: /tmp/opencode/studio_dry_run_success.png');
  }

  await browser.close();
})();
