// Click "คลิกเพื่อดูรูปโปรไฟล์" for นางสาวจิตรา ณีศะนันท์ and capture the image URL.
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
  const docReqs = [];
  p.on('request', r => {
    const u = r.url();
    if (/\/document\//.test(u) || r.resourceType() === 'image') docReqs.push(u.slice(0, 200));
  });

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

  const btnCount = await p.locator('text=คลิกเพื่อดูรูปโปรไฟล์').count();
  console.log('buttons labelled คลิกเพื่อดูรูปโปรไฟล์:', btnCount);

  // locate her row and its button
  const info = await p.evaluate((target) => {
    const nodes = [...document.querySelectorAll('*')].filter(e => e.children.length === 0 && (e.textContent || '').includes(target));
    const out = [];
    for (const n of nodes.slice(0, 3)) {
      let row = n;
      for (let i = 0; i < 8 && row; i++) {
        if (/คลิกเพื่อดูรูปโปรไฟล์/.test(row.innerText || '')) break;
        row = row.parentElement;
      }
      out.push({ tag: n.tagName, rowText: row ? row.innerText.replace(/\s+/g, ' ').slice(0, 120) : null, hasBtn: row ? /คลิกเพื่อดูรูปโปรไฟล์/.test(row.innerText || '') : false });
    }
    return out;
  }, TARGET);
  console.log('row lookup:', JSON.stringify(info, null, 1));

  let clicked = false;
  const targetRowBtn = p.locator('text=คลิกเพื่อดูรูปโปรไฟล์').filter({ has: p.locator(`xpath=ancestor::*[contains(., "${TARGET}")]`) });
  if (await targetRowBtn.count()) {
    await targetRowBtn.first().click({ timeout: 8000 }).then(() => { clicked = true; }).catch(() => {});
  }
  if (!clicked) {
    // fall back: click the button in the row that contains her name
    const ok = await p.evaluate((target) => {
      const nodes = [...document.querySelectorAll('*')].filter(e => e.children.length === 0 && (e.textContent || '').includes(target));
      for (const n of nodes) {
        let row = n;
        for (let i = 0; i < 10 && row; i++) {
          const btn = [...row.querySelectorAll('button, a, [role="button"], span')].find(e => /คลิกเพื่อดูรูปโปรไฟล์/.test(e.textContent || ''));
          if (btn) { btn.click(); return true; }
          row = row.parentElement;
        }
      }
      return false;
    }, TARGET);
    clicked = ok;
  }
  await p.waitForTimeout(6000);

  const modal = await p.evaluate(() => {
    const d = [...document.querySelectorAll('[role="dialog"], .cdk-overlay-pane, mat-dialog-container, .modal, [class*="overlay"]')]
      .find(e => e.offsetParent !== null && (e.innerText || '').length > 5);
    return d ? { text: d.innerText.replace(/\s+/g, ' ').slice(0, 160), imgs: [...d.querySelectorAll('img')].map(i => (i.currentSrc || i.src).slice(0, 200)) } : null;
  });

  console.log('clicked:', clicked);
  console.log('modal:', JSON.stringify(modal, null, 1));
  console.log('doc/img requests (last 10):');
  console.log([...new Set(docReqs)].slice(-10).join('\n'));
  await p.screenshot({ path: path.join(os.tmpdir(), 'profile_pic_modal.png') });
  await b.close();
})().catch(e => { console.error('FAILED:', e.message.split('\n')[0]); process.exit(1); });