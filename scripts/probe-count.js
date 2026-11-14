// How many people does eoffice actually list, and are there pagination controls?
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
  const api = [];
  p.on('response', r => { if (/officerRegistry|userProfile/.test(r.url())) api.push(r.status() + ' ' + r.url().split('?')[0].replace(BASE, '')); });

  await p.goto(BASE + '/sign-in?redirectURL=%2Fmwp%2Flist-officers', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('input[placeholder="ชื่อผู้ใช้งาน"]', { timeout: 30000 });
  await p.fill('input[placeholder="ชื่อผู้ใช้งาน"]', USER);
  await p.fill('input[placeholder="รหัสผ่าน"]', PASS);
  await p.click('button[type="submit"]:has-text("เข้าสู่ระบบ")');
  await p.waitForFunction(() => !location.href.includes('/sign-in'), { timeout: 40000 });
  await p.goto(BASE + '/mwp/list-officers', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(5000);
  await p.locator('button:has-text("แสดงรายชื่อ")').first().click();
  await p.waitForTimeout(9000);

  const info = await p.evaluate(() => {
    const text = document.body.innerText;
    const m = text.match(/(\d[\d,]*)\s*(คน|รายการ)/g);
    const total = [...document.querySelectorAll('[class*="paginator"], .mat-mdc-paginator, [class*="pagination"]')].map(e => e.innerText.replace(/\s+/g, ' ').slice(0, 80));
    // count visible person-ish entries
    const names = [...document.querySelectorAll('*')].filter(e => e.children.length === 0 && /^(นาย|นาง|นางสาว)/.test((e.textContent || '').trim())).length;
    return { counts: m, paginator: total, nameNodes: names, snippet: text.replace(/\s+/g, ' ').slice(0, 200) };
  });

  console.log('api calls:', JSON.stringify([...new Set(api)]));
  console.log('page info:', JSON.stringify(info, null, 1));
  await b.close();
})().catch(e => { console.error('FAILED:', e.message.split('\n')[0]); process.exit(1); });