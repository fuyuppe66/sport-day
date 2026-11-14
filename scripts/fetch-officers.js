// fetch-officers.js — login, open /mwp/list-officers, press "แสดงรายชื่อ", extract the roster.
// Credentials are read at runtime from ~/.secrets/*.txt; nothing is printed.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');

const SECRETS = path.join(os.homedir(), '.secrets');
const USER = fs.readFileSync(path.join(SECRETS, 'EOFFICE_USER.txt'), 'utf8').trim();
const PASS = fs.readFileSync(path.join(SECRETS, 'EOFFICE_PASS.txt'), 'utf8').trim();

const SIGN_IN = 'https://eoffice.vayupak.net/sign-in?redirectURL=%2Fnew_portal';
const OFFICERS = 'https://eoffice.vayupak.net/mwp/list-officers';
const OUT_JSON = path.join(__dirname, '..', 'officers_live_raw.json');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ locale: 'th-TH', viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();

  const hits = [];
  page.on('response', async (res) => {
    const ct = res.headers()['content-type'] || '';
    if (!/json/.test(ct)) return;
    if (/menuPermissions|\/params\/|publicSettings|\.js/.test(res.url())) return;
    try {
      const b = await res.json();
      const size = JSON.stringify(b).length;
      if (size < 400) return;
      hits.push({
        url: res.url(), status: res.status(), size,
        kind: Array.isArray(b) ? 'array' : 'object',
        sample: Array.isArray(b) && b[0] ? Object.keys(b[0]).slice(0, 25) : Object.keys(b).slice(0, 25),
      });
      if (Array.isArray(b) && b.length > 5) fs.writeFileSync(OUT_JSON, JSON.stringify(b, null, 2));
    } catch (e) {}
  });

  // 1) login
  await page.goto(SIGN_IN, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForSelector('input[placeholder="ชื่อผู้ใช้งาน"]', { timeout: 30000 });
  await page.fill('input[placeholder="ชื่อผู้ใช้งาน"]', USER);
  await page.fill('input[placeholder="รหัสผ่าน"]', PASS);
  await page.click('button[type="submit"]:has-text("เข้าสู่ระบบ")');
  await page.waitForFunction(() => !location.href.includes('/sign-in'), { timeout: 40000 }).catch(() => {});
  console.log('after login:', page.url());

  // 2) officers page (same session)
  await page.goto(OFFICERS, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(6000);
  console.log('officers page:', page.url());

  const state1 = await page.evaluate(() => ({
    inputs: [...document.querySelectorAll('input')].map(i => i.placeholder || i.name || i.type).slice(0, 15),
    selects: [...document.querySelectorAll('select')].map(s => s.name || s.id).slice(0, 10),
    buttons: [...document.querySelectorAll('button,a')].map(b => (b.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 45)).filter(Boolean).slice(0, 25),
    rows: document.querySelectorAll('table tbody tr').length,
    text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 250),
  }));
  console.log('PAGE:', JSON.stringify(state1, null, 2));

  // 3) click "แสดงรายชื่อ"
  let clicked = false;
  const candidates = ['button:has-text("แสดงรายชื่อ")', 'a:has-text("แสดงรายชื่อ")', 'button:has-text("แสดงรายชื่อบุคลากร")'];
  for (const sel of candidates) {
    const loc = page.locator(sel).first();
    if (await loc.count()) {
      clicked = await loc.click({ timeout: 15000 }).then(() => true).catch(() => false);
      if (clicked) { console.log('clicked via', sel); break; }
    }
  }
  if (!clicked) console.log('!! could not find the แสดงรายชื่อ button');
  await page.waitForTimeout(12000);

  // 4) extract the table
  const table = await page.evaluate(() => {
    const t = document.querySelector('table');
    if (!t) return { found: false, rows: 0 };
    const headers = [...t.querySelectorAll('thead th')].map(th => (th.innerText || '').trim());
    const rows = [...t.querySelectorAll('tbody tr')].map(tr =>
      [...tr.children].map(td => (td.innerText || '').trim().replace(/\s+/g, ' '))
    ).filter(r => r.some(c => c));
    return { found: true, headers, rows: rows.length, first3: rows.slice(0, 3), all: rows };
  });
  console.log('TABLE:', JSON.stringify({ found: table.found, headers: table.headers, rows: table.rows, first3: table.first3 }, null, 2));
  if (table.found && table.all) {
    fs.writeFileSync(path.join(__dirname, '..', 'officers_live_table.json'), JSON.stringify({ headers: table.headers, rows: table.all }, null, 2));
  }

  console.log('XHR JSON hits:', JSON.stringify(hits.slice(-12), null, 2));
  await page.screenshot({ path: path.join(os.tmpdir(), 'officers_page.png'), fullPage: false });
  await browser.close();
})().catch(e => { console.error('FAILED:', e.message.split('\n')[0]); process.exit(1); });