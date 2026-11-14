// Capture every JSON response after pressing "แสดงรายชื่อ" and save the big ones.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');

const SECRETS = path.join(os.homedir(), '.secrets');
const USER = fs.readFileSync(path.join(SECRETS, 'EOFFICE_USER.txt'), 'utf8').trim();
const PASS = fs.readFileSync(path.join(SECRETS, 'EOFFICE_PASS.txt'), 'utf8').trim();
const DIR = path.join(SECRETS, 'cap');
fs.mkdirSync(DIR, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ locale: 'th-TH', viewport: { width: 1500, height: 950 } });
  const page = await ctx.newPage();
  const seen = [];

  page.on('response', async (res) => {
    const req = res.request();
    let body = null;
    try { body = await res.body(); } catch (e) { return; }
    const ct = res.headers()['content-type'] || '';
    if (!/json/.test(ct)) return;
    const text = body.toString('utf8');
    const rec = { method: req.method(), url: res.url(), status: res.status(), ct: ct.split(';')[0], bytes: body.length };
    seen.push(rec);
    if (body.length > 4000) {
      const safe = rec.url.replace(/[^a-z0-9]+/gi, '_').slice(-60);
      fs.writeFileSync(path.join(DIR, `${seen.length}_${safe}.json`), text);
      rec.saved = `${seen.length}_${safe}.json`;
    }
    if (req.method() === 'POST') {
      try { rec.postData = (req.postData() || '').slice(0, 300); } catch (e) {}
    }
  });

  await page.goto('https://eoffice.vayupak.net/sign-in?redirectURL=%2Fmwp%2Flist-officers', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForSelector('input[placeholder="ชื่อผู้ใช้งาน"]', { timeout: 30000 });
  await page.fill('input[placeholder="ชื่อผู้ใช้งาน"]', USER);
  await page.fill('input[placeholder="รหัสผ่าน"]', PASS);
  await page.click('button[type="submit"]:has-text("เข้าสู่ระบบ")');
  await page.waitForFunction(() => !location.href.includes('/sign-in'), { timeout: 40000 }).catch(() => {});
  await page.goto('https://eoffice.vayupak.net/mwp/list-officers', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);

  const mark = seen.length;
  await page.locator('button:has-text("แสดงรายชื่อ")').first().click({ timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(15000);

  const dom = await page.evaluate(() => {
    const t = document.querySelector('table');
    const sel = (s) => document.querySelectorAll(s).length;
    return {
      tables: sel('table'),
      matTable: sel('mat-table'),
      matRow: sel('mat-row'),
      trs: sel('tr'),
      rowLike: sel('[class*="row"]'),
      totalText: (document.body.innerText.match(/รายชื่อทั้งหมด[^\n]*/) || [''])[0],
      firstRowHtml: (document.querySelector('mat-row, tbody tr, [class*="row"]') || {}).outerHTML?.slice(0, 400) || null,
    };
  });

  console.log('DOM:', JSON.stringify(dom, null, 2));
  console.log('POST-click responses:');
  console.log(JSON.stringify(seen.slice(mark).map(r => ({ m: r.method, s: r.status, b: r.bytes, u: r.url.slice(0, 120), post: r.postData ? r.postData.slice(0, 120) : undefined, saved: r.saved })), null, 2));
  console.log('saved files:', fs.readdirSync(DIR).join(', '));
  await browser.close();
})().catch(e => { console.error('FAILED:', e.message.split('\n')[0]); process.exit(1); });