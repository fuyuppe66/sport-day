// Do officer photos exist? Click a person and watch for image requests.
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
  const ctx = await browser.newContext({ locale: 'th-TH', viewport: { width: 1500, height: 950 } });
  const page = await ctx.newPage();

  const imgReqs = new Set();
  const apiReqs = new Set();
  page.on('request', (r) => {
    const u = r.url();
    if (r.resourceType() === 'image' || /\.(png|jpe?g|webp|gif)(\?|$)/i.test(u)) imgReqs.add(u.slice(0, 150));
    else if (/mof_api/.test(u)) apiReqs.add(u.split('?')[0]);
  });

  await page.goto(BASE + '/sign-in?redirectURL=%2Fmwp%2Flist-officers', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input[placeholder="ชื่อผู้ใช้งาน"]', { timeout: 30000 });
  await page.fill('input[placeholder="ชื่อผู้ใช้งาน"]', USER);
  await page.fill('input[placeholder="รหัสผ่าน"]', PASS);
  await page.click('button[type="submit"]:has-text("เข้าสู่ระบบ")');
  await page.waitForFunction(() => !location.href.includes('/sign-in'), { timeout: 40000 });
  await page.goto(BASE + '/mwp/list-officers', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  await page.locator('button:has-text("แสดงรายชื่อ")').first().click();
  await page.waitForTimeout(9000);

  const imgsBefore = await page.evaluate(() => [...new Set([...document.querySelectorAll('img')].map(i => i.currentSrc || i.src).filter(Boolean))].slice(0, 12));
  const personHtml = await page.evaluate(() => {
    const el = [...document.querySelectorAll('[class*="row"]')].find(e => (e.innerText || '').includes('ลวรณ'));
    return el ? el.outerHTML.slice(0, 900) : null;
  });

  // click the first person's name
  let clicked = '';
  for (const sel of [
    'text=นายลวรณ แสงสนิท',
    '[class*="row"]:has-text("นายลวรณ")',
    'td:has-text("นายลวรณ")',
  ]) {
    const loc = page.locator(sel).first();
    if (await loc.count()) { const ok = await loc.click({ timeout: 8000 }).then(() => true).catch(() => false); if (ok) { clicked = sel; break; } }
  }
  await page.waitForTimeout(6000);

  const after = await page.evaluate(() => ({
    url: location.href,
    imgs: [...new Set([...document.querySelectorAll('img')].map(i => i.currentSrc || i.src).filter(Boolean))].slice(0, 15),
    dialog: (document.querySelector('[role="dialog"], .cdk-overlay-pane, mat-dialog-container') || {}).innerText?.replace(/\s+/g, ' ').slice(0, 300) || null,
  }));

  console.log('CLICKED:', clicked || 'none');
  console.log('IMGS BEFORE:', JSON.stringify(imgsBefore));
  console.log('PERSON HTML:', personHtml);
  console.log('AFTER:', JSON.stringify(after, null, 2));
  console.log('IMAGE REQUESTS:', JSON.stringify([...imgReqs].slice(0, 20), null, 2));
  console.log('API PATHS:', JSON.stringify([...apiReqs].slice(0, 25), null, 2));
  await page.screenshot({ path: path.join(os.tmpdir(), 'officers_click.png') });
  await browser.close();
})().catch(e => { console.error('FAILED:', e.message.split('\n')[0]); process.exit(1); });