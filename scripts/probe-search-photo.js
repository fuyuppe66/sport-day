// Scan for photos that are not <img> (background-image) and try the header search.
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

async function scan(p, label) {
  const r = await p.evaluate(() => {
    const bgs = [...document.querySelectorAll('*')]
      .map(e => getComputedStyle(e).backgroundImage)
      .filter(s => s && s.includes('document'))
      .slice(0, 8);
    const raw = document.documentElement.outerHTML.match(/document\/Temp\/[^"'\s)]{0,80}/g) || [];
    return { bgs, rawRefs: [...new Set(raw)].slice(0, 8) };
  });
  console.log(label, JSON.stringify(r));
}

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ locale: 'th-TH', viewport: { width: 1500, height: 950 } });
  const p = await ctx.newPage();
  p.on('request', r => { if (/\/document\//.test(r.url())) console.log('DOC REQ:', r.url().slice(0, 150)); });

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
  await scan(p, 'roster page:');

  // type her name into every visible search box one at a time
  const boxes = p.locator('input[type="text"]');
  const n = await boxes.count();
  for (let i = 0; i < n; i++) {
    const bx = boxes.nth(i);
    if (!(await bx.isVisible().catch(() => false))) continue;
    await bx.click().catch(() => {});
    await bx.fill('จิตรา').catch(() => {});
    await p.waitForTimeout(3000);
    const found = await p.locator('text=จิตรา').count();
    if (found) {
      console.log('search box', i, 'matched, clicking result');
      await p.locator('text=จิตรา').first().click({ timeout: 6000 }).catch(() => {});
      await p.waitForTimeout(5000);
      await scan(p, 'after click ' + i + ':');
      const imgs = await p.evaluate(() => [...new Set([...document.querySelectorAll('img')].map(i => i.currentSrc || i.src).filter(s => s && !s.startsWith('data:') && !s.includes('assets')))].slice(0, 8));
      console.log('  imgs:', JSON.stringify(imgs.map(s => s.slice(-80))));
    }
    await bx.fill('').catch(() => {});
    await p.waitForTimeout(800);
  }
  await p.screenshot({ path: path.join(os.tmpdir(), 'scan_search.png') });
  await b.close();
})().catch(e => { console.error('FAILED:', e.message.split('\n')[0]); process.exit(1); });