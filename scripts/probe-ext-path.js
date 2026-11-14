// Find which API/response produces /document/Temp/profile/EXT786/786010.JPG
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
const RE = /\/document\/Temp\/[^"'\\\s)]{3,80}/g;

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ locale: 'th-TH', viewport: { width: 1500, height: 950 } });
  const p = await ctx.newPage();
  const hits = [];

  p.on('response', async (res) => {
    const ct = res.headers()['content-type'] || '';
    if (!/json|html|text/.test(ct)) return;
    try {
      const t = await res.text();
      const m = t.match(RE);
      if (m) hits.push({ url: res.url().split('?')[0].replace(BASE, ''), found: [...new Set(m)].slice(0, 6) });
    } catch (e) {}
  });

  await p.goto(BASE + '/sign-in?redirectURL=%2Fnew_portal', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('input[placeholder="ชื่อผู้ใช้งาน"]', { timeout: 30000 });
  await p.fill('input[placeholder="ชื่อผู้ใช้งาน"]', USER);
  await p.fill('input[placeholder="รหัสผ่าน"]', PASS);
  await p.click('button[type="submit"]:has-text("เข้าสู่ระบบ")');
  await p.waitForFunction(() => !location.href.includes('/sign-in'), { timeout: 40000 });
  await p.waitForTimeout(3000);

  // try the executive directory style pages
  const pages = ['/mwp/list-officers', '/mwp/executive', '/mwp/executives', '/mwp/list-executive'];
  for (const pth of pages) {
    const r = await p.goto(BASE + pth, { waitUntil: 'domcontentloaded' }).catch(() => null);
    await p.waitForTimeout(4000);
    if (!r || r.status() !== 200) continue;
    const hasRoster = await p.locator('button:has-text("แสดงรายชื่อ")').count();
    if (hasRoster) { await p.locator('button:has-text("แสดงรายชื่อ")').first().click().catch(() => {}); await p.waitForTimeout(8000); }

    // click her name if visible
    const loc = p.locator(`text=${TARGET}`).first();
    if (await loc.count()) { await loc.click({ timeout: 5000 }).catch(() => {}); await p.waitForTimeout(4000); }
    const btn = p.locator('text=คลิกเพื่อดูรูปโปรไฟล์').first();
    if (await btn.count()) {
      await btn.click({ timeout: 5000 }).catch(() => {});
      await p.waitForTimeout(4000);
      const src = await p.evaluate(() => {
        const imgs = [...document.querySelectorAll('img')].map(i => i.getAttribute('src') || '');
        return imgs.filter(s => /profile\/EXT/.test(s)).slice(0, 4);
      });
      console.log(pth, 'img srcs:', JSON.stringify(src));
    }
  }

  console.log('--- responses containing /document/Temp ---');
  for (const h of hits.slice(0, 20)) console.log(h.url, '->', h.found.join(' , '));
  await b.close();
})().catch(e => { console.error('FAILED:', e.message.split('\n')[0]); process.exit(1); });