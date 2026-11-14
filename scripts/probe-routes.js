// Hunt for a person-detail route that loads a photo for officer 3326.
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
  const b = await chromium.launch();
  const ctx = await b.newContext({ locale: 'th-TH', viewport: { width: 1500, height: 950 } });
  const p = await ctx.newPage();
  let docReqs = [];
  p.on('request', r => { if (/\/document\//.test(r.url())) docReqs.push(r.url()); });

  await p.goto(BASE + '/sign-in?redirectURL=%2Fmwp%2Flist-officers', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('input[placeholder="ชื่อผู้ใช้งาน"]', { timeout: 30000 });
  await p.fill('input[placeholder="ชื่อผู้ใช้งาน"]', USER);
  await p.fill('input[placeholder="รหัสผ่าน"]', PASS);
  await p.click('button[type="submit"]:has-text("เข้าสู่ระบบ")');
  await p.waitForFunction(() => !location.href.includes('/sign-in'), { timeout: 40000 });

  await p.goto(BASE + '/mwp/list-officers', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(5000);

  // what controls does the roster page offer?
  const btns = await p.evaluate(() => [...document.querySelectorAll('button, a')].map(e => (e.innerText || '').trim()).filter(t => t && t.length < 40).slice(0, 30));

  await p.locator('button:has-text("แสดงรายชื่อ")').first().click();
  await p.waitForTimeout(8000);

  const routes = ['/mwp/profile/3326', '/mwp/officer-profile/3326', '/mwp/user-profile/3326', '/mwp/officerProfile/3326', '/mwp/person/3326', '/mwp/list-officers/3326', '/mwp/officer/3326', '/mwp/hr/profile/3326'];
  const results = [];
  for (const r of routes) {
    docReqs = [];
    const resp = await p.goto(BASE + r, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => null);
    await p.waitForTimeout(3500);
    const txt = await p.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 90)).catch(() => '');
    results.push({ route: r, status: resp ? resp.status() : 'ERR', url: p.url().replace(BASE, ''), docs: docReqs.filter(u => /profile/.test(u)), txt });
  }

  console.log('buttons:', JSON.stringify(btns));
  console.log(JSON.stringify(results, null, 1));
  await b.close();
})().catch(e => { console.error('FAILED:', e.message.split('\n')[0]); process.exit(1); });