// Find where eoffice gets จิตรา ณีศะนันท์'s (id 3326) photo from.
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

function findPhotoFields(obj, prefix, out, depth = 0) {
  if (!obj || depth > 6) return;
  if (Array.isArray(obj)) { obj.slice(0, 5).forEach((v, i) => findPhotoFields(v, `${prefix}[${i}]`, out, depth + 1)); return; }
  if (typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      if (/photo|image|avatar|picture|img/i.test(k) && v) out.push(`${prefix}.${k} = ${String(v).slice(0, 120)}`);
      else findPhotoFields(v, `${prefix}.${k}`, out, depth + 1);
    }
  }
}

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ locale: 'th-TH', viewport: { width: 1500, height: 950 } });
  const p = await ctx.newPage();
  const photoFields = [];
  const imgs = new Set();
  const jsonHits = [];

  p.on('response', async (res) => {
    const ct = res.headers()['content-type'] || '';
    if (/json/.test(ct)) {
      try {
        const j = await res.json();
        const out = [];
        findPhotoFields(j, res.url().split('?')[0].replace(BASE, ''), out);
        if (out.length) photoFields.push(...out.slice(0, 6));
        if (JSON.stringify(j).includes('3326')) jsonHits.push(res.url().split('?')[0].replace(BASE, ''));
      } catch (e) {}
    }
  });
  p.on('request', r => { if (/\/document\/|resourceType=image/.test(r.url()) || r.resourceType() === 'image') imgs.add(r.url().slice(0, 160)); });

  await p.goto(BASE + '/sign-in?redirectURL=%2Fmwp%2Flist-officers', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('input[placeholder="ชื่อผู้ใช้งาน"]', { timeout: 30000 });
  await p.fill('input[placeholder="ชื่อผู้ใช้งาน"]', USER);
  await p.fill('input[placeholder="รหัสผ่าน"]', PASS);
  await p.click('button[type="submit"]:has-text("เข้าสู่ระบบ")');
  await p.waitForFunction(() => !location.href.includes('/sign-in'), { timeout: 40000 });

  // portal home often shows cards with photos
  await p.goto(BASE + '/new_portal', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(5000);

  await p.goto(BASE + '/mwp/list-officers', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(5000);
  await p.locator('button:has-text("แสดงรายชื่อ")').first().click();
  await p.waitForTimeout(8000);

  // search her via the page search box, if any
  const boxes = p.locator('input[placeholder="ค้นหา..."]');
  const n = await boxes.count();
  for (let i = 0; i < n; i++) {
    const bx = boxes.nth(i);
    if (!(await bx.isVisible().catch(() => false))) continue;
    await bx.fill(TARGET).catch(() => {});
    await p.waitForTimeout(2500);
    const still = await p.locator(`text=${TARGET}`).count();
    if (still) break;
  }
  await p.waitForTimeout(2500);

  // click her entry
  const loc = p.locator(`text=${TARGET}`).first();
  if (await loc.count()) await loc.click({ timeout: 8000 }).catch(() => {});
  await p.waitForTimeout(6000);

  const domImgs = await p.evaluate(() => [...new Set([...document.querySelectorAll('img')].map(i => i.currentSrc || i.src).filter(s => s && !s.startsWith('data:')))].slice(0, 20));

  console.log('=== photo-ish JSON fields ===');
  console.log([...new Set(photoFields)].slice(0, 15).join('\n') || '(none)');
  console.log('=== responses mentioning 3326 ===');
  console.log([...new Set(jsonHits)].join('\n') || '(none)');
  console.log('=== image/document requests ===');
  console.log([...imgs].join('\n') || '(none)');
  console.log('=== <img> in DOM (filtered) ===');
  console.log(domImgs.map(s => s.slice(-90)).join('\n') || '(none)');
  await p.screenshot({ path: path.join(os.tmpdir(), 'target_person.png'), fullPage: false });
  await b.close();
})().catch(e => { console.error('FAILED:', e.message.split('\n')[0]); process.exit(1); });