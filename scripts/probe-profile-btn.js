// Click the single "คลิกเพื่อดูรูปโปรไฟล์" control and see what the modal shows.
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

async function run(p, label) {
  const before = Date.now();
  const btn = p.locator('text=คลิกเพื่อดูรูปโปรไฟล์').first();
  if (!(await btn.count())) { console.log(label, ': button not found'); return; }
  await btn.click({ timeout: 8000 }).catch(() => {});
  await p.waitForTimeout(4000);
  const res = await p.evaluate(() => {
    const d = [...document.querySelectorAll('*')].filter(e => e.offsetParent !== null && /รูปโปรไฟล์/.test(e.innerText || '') && e.children.length > 0 && e.innerText.length < 400);
    const modal = d[d.length - 1];
    const imgs = [...document.querySelectorAll('img')].map(i => (i.currentSrc || i.src)).filter(s => s && !s.startsWith('data:') && !s.includes('assets'));
    return {
      modalText: modal ? modal.innerText.replace(/\s+/g, ' ').slice(0, 220) : null,
      imgs: [...new Set(imgs)].slice(0, 6).map(s => s.slice(-110)),
    };
  });
  console.log(label, ':', JSON.stringify(res, null, 1));
  await p.keyboard.press('Escape').catch(() => {});
}

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ locale: 'th-TH', viewport: { width: 1500, height: 950 } });
  const p = await ctx.newPage();
  p.on('request', r => { if (/\/document\//.test(r.url())) console.log('DOC:', r.url().slice(0, 160)); });

  await p.goto(BASE + '/sign-in?redirectURL=%2Fnew_portal', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('input[placeholder="ชื่อผู้ใช้งาน"]', { timeout: 30000 });
  await p.fill('input[placeholder="ชื่อผู้ใช้งาน"]', USER);
  await p.fill('input[placeholder="รหัสผ่าน"]', PASS);
  await p.click('button[type="submit"]:has-text("เข้าสู่ระบบ")');
  await p.waitForFunction(() => !location.href.includes('/sign-in'), { timeout: 40000 });
  await p.waitForTimeout(5000);

  await run(p, 'portal');

  await p.goto(BASE + '/mwp/list-officers', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(5000);
  await p.locator('button:has-text("แสดงรายชื่อ")').first().click();
  await p.waitForTimeout(9000);
  await run(p, 'roster');

  await p.screenshot({ path: path.join(os.tmpdir(), 'profile_btn_modal.png') });
  await b.close();
})().catch(e => { console.error('FAILED:', e.message.split('\n')[0]); process.exit(1); });