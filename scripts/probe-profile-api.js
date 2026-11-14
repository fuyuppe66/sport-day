// Login once, reuse the JWT + signature scheme to query arbitrary endpoints from Node.
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

const signed = () => {
  const e = String(Math.floor(Date.now() / 1000) + 15);
  const p = crypto.createHash('md5').update(`${e} ${KEY}`).digest().toString('base64url');
  return `p=${p}&e=${e}`;
};

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ locale: 'th-TH' });
  const p = await ctx.newPage();

  let bearer = null;
  p.on('request', (r) => {
    const h = r.headers();
    if (!bearer && h.authorization && /^Bearer /i.test(h.authorization) && /mof_api/.test(r.url())) bearer = h.authorization;
  });

  await p.goto(BASE + '/sign-in?redirectURL=%2Fnew_portal', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('input[placeholder="ชื่อผู้ใช้งาน"]', { timeout: 30000 });
  await p.fill('input[placeholder="ชื่อผู้ใช้งาน"]', USER);
  await p.fill('input[placeholder="รหัสผ่าน"]', PASS);
  await p.click('button[type="submit"]:has-text("เข้าสู่ระบบ")');
  const ok = await p.waitForFunction(() => !location.href.includes('/sign-in'), { timeout: 40000 }).then(() => true).catch(() => false);
  if (!ok) throw new Error('login failed');
  await p.waitForTimeout(4000);

  // fall back to storage if no request header was seen
  if (!bearer) {
    const tok = await p.evaluate(() => {
      for (const k of Object.keys(localStorage)) if (/token/i.test(k)) return localStorage.getItem(k);
      return null;
    });
    if (tok) bearer = /^Bearer /.test(tok) ? tok : 'Bearer ' + tok.replace(/^"|"$/g, '');
  }
  console.log('token captured:', !!bearer);
  await b.close();

  const get = async (path) => {
    const sep = path.includes('?') ? '&' : '?';
    const res = await fetch(`${BASE}${path}${sep}${signed()}`, { headers: { authorization: bearer } });
    const t = await res.text();
    let j = null; try { j = JSON.parse(t); } catch (e) {}
    return { status: res.status, body: j, raw: t.slice(0, 200) };
  };

  for (const id of [3326, 382]) {
    const r = await get(`/mof_api/v1/userProfiles/${id}`);
    if (r.status !== 200) { console.log('userProfiles', id, r.status, r.raw); continue; }
    const flat = [];
    const walk = (o, pre, d = 0) => {
      if (!o || typeof o !== 'object' || d > 3) return;
      for (const [k, v] of Object.entries(o)) {
        if (v && typeof v === 'object') walk(v, `${pre}.${k}`, d + 1);
        else if (/photo|image|avatar|picture|img|file/i.test(k)) flat.push(`${pre}.${k} = ${String(v).slice(0, 100)}`);
      }
    };
    walk(r.body, 'root');
    console.log('--- userProfiles', id, '---');
    console.log('keys:', Object.keys(r.body).join(','));
    console.log('photo-ish:', flat.slice(0, 10).join(' | ') || '(none)');
    console.log('sample:', JSON.stringify(r.body).slice(0, 400));
  }
  fs.writeFileSync(path.join(os.tmpdir(), 'token.txt'), ''); // discard, never persist token
})().catch(e => { console.error('FAILED:', e.message.split('\n')[0]); process.exit(1); });