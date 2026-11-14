// Does eoffice itself show a photo for an id our downloader can't find?
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
const TARGET = 'จิตรา';

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ locale: 'th-TH', viewport: { width: 1500, height: 950 } });
  const p = await ctx.newPage();
  const docs = new Set();
  p.on('request', r => { if (/\/document\//.test(r.url()) || r.resourceType() === 'image') docs.add(r.url().slice(0, 140)); });

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

  // any search box on the roster page?
  const inputs = await p.evaluate(() => [...document.querySelectorAll('input')].map(i => ({ ph: i.placeholder, type: i.type })).slice(0, 8));

  // find the target row and click it
  let clicked = '';
  for (const sel of [`text=${TARGET}`, `[class*="row"]:has-text("${TARGET}")`]) {
    const loc = p.locator(sel).first();
    if (await loc.count()) {
      const ok = await loc.click({ timeout: 6000 }).then(() => true).catch(() => false);
      if (ok) { clicked = sel; break; }
    }
  }
  await p.waitForTimeout(6000);

  const imgs = await p.evaluate(() => [...new Set([...document.querySelectorAll('img')].map(i => i.currentSrc || i.src).filter(Boolean))].slice(0, 15).map(s => s.slice(-120)));
  const dialog = await p.evaluate(() => {
    const d = document.querySelector('[role="dialog"], .cdk-overlay-pane, mat-dialog-container, .modal');
    return d ? d.innerText.replace(/\s+/g, ' ').slice(0, 200) : null;
  });
  console.log('inputs:', JSON.stringify(inputs));
  console.log('clicked:', clicked || 'none');
  console.log('dialog:', dialog);
  console.log('imgs:', JSON.stringify(imgs));
  console.log('doc/img requests:', JSON.stringify([...docs].slice(-12), null, 1));
  await p.screenshot({ path: path.join(os.tmpdir(), 'person_probe.png') });
  await b.close();
})().catch(e => { console.error('FAILED:', e.message.split('\n')[0]); process.exit(1); });