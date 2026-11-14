// What auth headers/storage does the app actually use?
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
  const ctx = await b.newContext({ locale: 'th-TH' });
  const p = await ctx.newPage();
  const headerSets = new Set();

  p.on('request', (r) => {
    if (!/mof_api/.test(r.url())) return;
    const h = r.headers();
    headerSets.add(Object.keys(h).filter(k => /auth|token|key|x-/i.test(k)).join(','));
  });

  await p.goto(BASE + '/sign-in?redirectURL=%2Fnew_portal', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('input[placeholder="ชื่อผู้ใช้งาน"]', { timeout: 30000 });
  await p.fill('input[placeholder="ชื่อผู้ใช้งาน"]', USER);
  await p.fill('input[placeholder="รหัสผ่าน"]', PASS);
  await p.click('button[type="submit"]:has-text("เข้าสู่ระบบ")');
  await p.waitForFunction(() => !location.href.includes('/sign-in'), { timeout: 40000 });
  await p.waitForTimeout(5000);

  const storage = await p.evaluate(() => ({
    local: Object.keys(localStorage),
    session: Object.keys(sessionStorage),
    cookies: document.cookie.split(';').map(c => c.trim().split('=')[0]).filter(Boolean),
  }));
  const authSample = await p.evaluate(async () => {
    const res = await fetch('/mof_api/v1/userProfiles/-1');
    return { status: res.status };
  });

  console.log('auth-ish request headers:', JSON.stringify([...headerSets]));
  console.log('storage:', JSON.stringify(storage, null, 1));
  console.log('in-page fetch status:', JSON.stringify(authSample));
  await b.close();
})().catch(e => { console.error('FAILED:', e.message.split('\n')[0]); process.exit(1); });