// Authenticated direct API access: login once, then plain fetch with px-auth-token + signature.
// Usage: node scripts/eoffice-client.js <path> [<path> ...]
const crypto = require('crypto');
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
const KEY = 'px.Secure.Link';

const signedQuery = () => {
  const e = String(Math.floor(Date.now() / 1000) + 15);
  const p = crypto.createHash('md5').update(`${e} ${KEY}`).digest().toString('base64url');
  return `p=${p}&e=${e}`;
};

async function login() {
  const b = await chromium.launch();
  const ctx = await b.newContext({ locale: 'th-TH' });
  const p = await ctx.newPage();
  await p.goto(BASE + '/sign-in?redirectURL=%2Fnew_portal', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('input[placeholder="ชื่อผู้ใช้งาน"]', { timeout: 30000 });
  await p.fill('input[placeholder="ชื่อผู้ใช้งาน"]', USER);
  await p.fill('input[placeholder="รหัสผ่าน"]', PASS);
  await p.click('button[type="submit"]:has-text("เข้าสู่ระบบ")');
  const ok = await p.waitForFunction(() => !location.href.includes('/sign-in'), { timeout: 40000 }).then(() => true).catch(() => false);
  if (!ok) { await b.close(); throw new Error('login failed'); }
  await p.waitForTimeout(3000);
  const sess = await p.evaluate(() => ({
    token: sessionStorage.getItem('accessToken'),
    pic: localStorage.getItem('picProfileUrl'),
  }));
  await b.close();
  if (!sess.token) throw new Error('no accessToken in sessionStorage');
  return sess;
}

async function apiGet(token, apiPath) {
  const sep = apiPath.includes('?') ? '&' : '?';
  const res = await fetch(`${BASE}${apiPath}${sep}${signedQuery()}`, { headers: { 'px-auth-token': token.replace(/^"|"$/g, '') } });
  const t = await res.text();
  let body = null; try { body = JSON.parse(t); } catch (e) {}
  return { status: res.status, body, raw: t.slice(0, 300) };
}

module.exports = { login, apiGet, BASE };

if (require.main === module) {
  (async () => {
    const paths = process.argv.slice(2);
    if (!paths.length) { console.log('usage: node scripts/eoffice-client.js /mof_api/v1/...'); process.exit(1); }
    const { token, pic } = await login();
    console.log('own picProfileUrl:', pic);
    for (const pth of paths) {
      const r = await apiGet(token, pth);
      console.log('\n===', pth, '->', r.status);
      console.log(r.status === 200 ? JSON.stringify(r.body).slice(0, 1200) : r.raw);
    }
  })().catch(e => { console.error('FAILED:', e.message.split('\n')[0]); process.exit(1); });
}