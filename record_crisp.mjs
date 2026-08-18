import { chromium } from "playwright";
import * as path from "path";
import * as fs from "fs";
import { execSync } from "child_process";

async function recordCrispDemo() {
  console.log("🎬 Recording Ultra-Crisp Smooth Walkthrough Video...");

  const videoDir = path.join(process.cwd(), "public", "demo-raw");
  if (!fs.existsSync(videoDir)) {
    fs.mkdirSync(videoDir, { recursive: true });
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    recordVideo: {
      dir: videoDir,
      size: { width: 1280, height: 720 },
    },
    viewport: { width: 1280, height: 720 },
  });

  const page = await context.newPage();

  // Helper smooth scroll
  const smoothScroll = async (y, steps = 10) => {
    for (let i = 0; i < steps; i++) {
      await page.evaluate((delta) => window.scrollBy(0, delta), y / steps);
      await page.waitForTimeout(60);
    }
  };

  // ── SCENE 1: STUDIO 1-CLICK LAUNCHPAD (~12s) ──
  console.log("📹 [Scene 1] Studio Cockpit Setup...");
  await page.goto("https://adexto.xyz/studio", { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);

  // Edit Token Name
  const nameInput = page.locator("input").filter({ hasText: "" }).nth(0);
  await nameInput.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Backspace");
  await page.keyboard.type("Adexto Protocol", { delay: 45 });
  await page.waitForTimeout(600);

  // Edit Ticker
  const tickerInput = page.locator("input").filter({ hasText: "" }).nth(1);
  await tickerInput.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Backspace");
  await page.keyboard.type("ADEXTO", { delay: 45 });
  await page.waitForTimeout(800);

  // Toggle Omnichain Chains
  console.log("📹 Toggling Omnichain Pills...");
  await page.getByText("Arbitrum").first().click();
  await page.waitForTimeout(500);
  await page.getByText("Monad").first().click();
  await page.waitForTimeout(500);
  await page.getByText("Base").first().click();
  await page.waitForTimeout(500);
  await page.getByText("⚡ All (Omnichain)").first().click();
  await page.waitForTimeout(1000);

  // Click World ID Anti-Sybil Gate
  console.log("📹 Verifying World ID...");
  const worldIdBtn = page.getByRole("button", { name: /Verify with World ID/i });
  if (await worldIdBtn.isVisible()) {
    await worldIdBtn.click();
    await page.waitForTimeout(1200);
  }

  // AI Co-Pilot chat prompt in Studio
  const studioAiChat = page.getByPlaceholder(/Ask 0G/i);
  if (await studioAiChat.isVisible()) {
    await studioAiChat.click();
    await page.keyboard.type("Generate tokenomics report for $ADEXTO", { delay: 35 });
    await page.keyboard.press("Enter");
    await page.waitForTimeout(2500);
  }

  // ── SCENE 2: DEX SWAP TERMINAL (~6s) ──
  console.log("📹 [Scene 2] DEX Swap Terminal Overview...");
  await page.goto("https://adexto.xyz/swap", { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  await smoothScroll(300, 12);
  await page.waitForTimeout(1200);
  await smoothScroll(-300, 12);
  await page.waitForTimeout(800);

  // ── SCENE 3: EXPLORER (~7s) ──
  console.log("📹 [Scene 3] Multi-Chain Explorer...");
  await page.goto("https://adexto.xyz/explorer", { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);

  // Click filter buttons
  const monadFilter = page.getByRole("button", { name: /monad/i });
  if (await monadFilter.isVisible()) {
    await monadFilter.click();
    await page.waitForTimeout(1000);
  }
  const allFilter = page.getByRole("button", { name: /all/i }).first();
  if (await allFilter.isVisible()) {
    await allFilter.click();
    await page.waitForTimeout(1000);
  }

  // Hover over Adexto project card
  const adextoCard = page.getByText("Adexto Protocol").first();
  if (await adextoCard.isVisible()) {
    await adextoCard.hover();
    await page.waitForTimeout(1200);
  }

  // ── SCENE 4: TOKEN TERMINAL & LIVE TRADING (~12s) ──
  console.log("📹 [Scene 4] Live Token Terminal ($ADEXTO)...");
  await page.goto("https://adexto.xyz/token/adexto", { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);

  // Interact with Swap Terminal
  const payInput = page.locator("input[placeholder='0.0']");
  if (await payInput.isVisible()) {
    await payInput.click();
    await page.keyboard.type("1", { delay: 100 });
    await page.waitForTimeout(1200);
  }

  // Send Signal Request to Agent
  const agentChat = page.getByPlaceholder(/Ask ADEXTO/i);
  if (await agentChat.isVisible()) {
    await agentChat.click();
    await page.keyboard.type("Give me live Sovereign AMM depth signal", { delay: 35 });
    await page.keyboard.press("Enter");
    await page.waitForTimeout(3000);
  }

  console.log("📹 Finalizing recording...");
  await context.close();
  await browser.close();

  // Convert raw WebM to high quality fast MP4
  const files = fs.readdirSync(videoDir).filter(f => f.endsWith(".webm"));
  if (files.length > 0) {
    const rawVideo = path.join(videoDir, files[0]);
    const finalMp4 = path.join(process.cwd(), "public", "adexto_demo.mp4");
    const finalWebm = path.join(process.cwd(), "public", "adexto_demo.webm");

    console.log(`🎬 Encoding smooth Web-Optimized MP4 & WebM...`);
    execSync(`ffmpeg -y -i "${rawVideo}" -c:v libx264 -preset fast -crf 20 -pix_fmt yuv420p -r 30 "${finalMp4}"`);
    execSync(`ffmpeg -y -i "${rawVideo}" -c:v libvpx-vp9 -b:v 1.5M -r 30 "${finalWebm}"`);

    fs.rmSync(videoDir, { recursive: true, force: true });
    console.log("✅ Perfect Demo Video Rendered successfully!");
  }
}

recordCrispDemo().catch(console.error);
