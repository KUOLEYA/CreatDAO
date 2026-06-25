const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { mockProvider } = require('./metamask-mock');

const SCREENSHOT_DIR = path.join(__dirname, '..', '.playwright', 'screenshots');
const BASE_URL = process.env.BASE_URL || 'http://localhost:8080';
const PAGE_TIMEOUT = 12000;

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

const PAGES_TO_TEST = [
  { name: 'home', url: `${BASE_URL}/home.html`, wallet: false },
  { name: 'dashboard', url: `${BASE_URL}/dashboard.html`, wallet: true },
  { name: 'admin', url: `${BASE_URL}/admin.html`, wallet: true },
  { name: 'ai-review', url: `${BASE_URL}/ai-review.html`, wallet: true },
  { name: 'audit-team', url: `${BASE_URL}/audit-team.html`, wallet: true },
  { name: 'proposal-writing', url: `${BASE_URL}/proposal-writing.html`, wallet: true },
  { name: 'report-writing', url: `${BASE_URL}/report-writing.html`, wallet: true },
  { name: 'test-case-writing', url: `${BASE_URL}/test-case-writing.html`, wallet: true },
  { name: 'audit-report-query', url: `${BASE_URL}/audit-report-query.html`, wallet: false },
  { name: 'dispute-committee', url: `${BASE_URL}/dispute-committee.html`, wallet: true },
  { name: 'pricing', url: `${BASE_URL}/pricing.html`, wallet: false },
];

function pad(s, n) { return (s || '').padEnd(n); }

async function testOnePage(browser, { name, url, wallet }) {
  const result = { name, url, ok: false, jsErrors: [], walletDetected: false };
  const errors = [];
  let page = null;

  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    page = await context.newPage();
    page.setDefaultTimeout(PAGE_TIMEOUT);

    page.on('pageerror', err => errors.push(err.message));

    await page.addInitScript(mockProvider);

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT });
    } catch (e) {
      result.loadWarning = e.message.slice(0, 60);
    }

    try { await page.waitForTimeout(1000); } catch (e) {}

    try {
      result.title = await page.evaluate(() => document.title);
    } catch (e) {
      result.title = 'N/A';
    }

    try {
      result.walletDetected = await page.evaluate(() => typeof window.ethereum !== 'undefined');
      if (wallet && result.walletDetected) {
        const accounts = await page.evaluate(() => window.ethereum.request({ method: 'eth_requestAccounts' }));
        result.walletConnected = !!(accounts && accounts.length > 0);
        if (result.walletConnected) result.walletAddress = accounts[0];
      }
    } catch (e) {
      result.walletError = String(e).slice(0, 50);
    }

    try {
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${name}.png`), timeout: 8000 });
      result.screenshot = `${name}.png`;
    } catch (e) {
      console.log(`    [截图失败] ${name}: ${String(e).slice(0, 60)}`);
      result.screenshotError = String(e).slice(0, 50);
    }

    result.jsErrors = errors;
    result.ok = errors.length === 0;

    const walletLabel = wallet
      ? (result.walletConnected ? '🔗已连接' : (result.walletDetected ? '🟡检测到' : '❌未检测'))
      : '--';
    const title = (result.title || result.loadWarning || 'N/A');
    console.log(`  ${result.ok ? '✅' : '⚠️'} ${pad(name, 18)} | ${pad(title.slice(0, 26), 28)} | ${walletLabel} | err:${errors.length}`);
  } catch (e) {
    result.fatalError = String(e).slice(0, 80);
    console.log(`  ❌ ${pad(name, 18)} | ${result.fatalError}`);
  } finally {
    try { if (page) await page.context().close(); } catch (e) {}
  }

  return result;
}

async function main() {
  console.log('🚀 Playwright + Mock MetaMask 测试\n');
  console.log('='.repeat(78));
  console.log('🔌 Mock Provider (账户: 0xE3bd...8048, 网络: Sepolia)\n');

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  const results = [];
  for (let i = 0; i < PAGES_TO_TEST.length; i++) {
    const p = PAGES_TO_TEST[i];
    const result = await testOnePage(browser, p);
    results.push(result);
  }

  await browser.close();

  console.log('\n' + '='.repeat(78));
  console.log('📊 测试结果汇总\n');

  let pass = 0, fail = 0, walletOk = 0, screenshotOk = 0;
  for (const r of results) {
    const icon = r.ok ? '✅' : (r.fatalError ? '💥' : '❌');
    const walletIcon = r.walletConnected ? '🔗' : (r.walletDetected ? '🟡' : '--');
    if (r.walletConnected) walletOk++;
    if (r.screenshot) screenshotOk++;

    const status = r.fatalError ? 'CRASH' : (r.ok ? 'PASS' : 'FAIL');
    const title = (r.title || r.fatalError || '?').slice(0, 26);
    console.log(`${icon} ${pad(r.name, 18)} ${pad(status, 6)} ${walletIcon}  err:${r.jsErrors.length}  ${title}`);
    if (r.ok) pass++; else fail++;
  }

  console.log(`\n总计: ${results.length} 页 | 通过: ${pass} ✅ | 失败: ${fail} ❌`);
  console.log(`截图: ${screenshotOk}/${results.length} → ${SCREENSHOT_DIR}/`);
  console.log(`钱包: ${walletOk}/${PAGES_TO_TEST.filter(p => p.wallet).length} 个需钱包的页面已连接`);

  if (fail > 0) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
