// fetch-roster.js — live roster from eoffice.vayupak.net (MOF Digital Office).
// Logs in, opens /mwp/list-officers, presses "แสดงรายชื่อ", captures
// /mof_api/v1/officerRegistry/officers + /officerRegistry/structures,
// downloads profile photos and writes officials_live.json in the same shape
// as officials_504.json (what the app already consumes).
//
// Credentials: ~/.secrets/EOFFICE_USER.txt + EOFFICE_PASS.txt (never printed).
// Usage: node scripts/fetch-roster.js [--replace] [--no-photos]
const fs = require('fs');
const os = require('os');
const path = require('path');
const os0 = require('os');
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) {
  // fall back to the Playwright install used by the MCP server
  ({ chromium } = require(require('path').join(os0.homedir(), 'mcp', 'playwright', 'node_modules', 'playwright')));
}

const SECRETS = path.join(os.homedir(), '.secrets');
const ROOT = path.join(__dirname, '..');
const { fetchPhotos: fetchPhotosApi } = require('./lib-photos.js');
const OUT = path.join(ROOT, 'officials_live.json');
const RAW_DIR = path.join(SECRETS, 'raw');

const BASE = 'https://eoffice.vayupak.net';
const SIGN_IN = BASE + '/sign-in?redirectURL=%2Fmwp%2Flist-officers';
const OFFICERS = BASE + '/mwp/list-officers';
const API_MATCH = '/officerRegistry/officers';
const STRUCT_MATCH = '/officerRegistry/structures';

const HONORIFICS = ['นางสาว', 'นาง', 'นาย', 'ว่าที่ร้อยตรี', 'ร้อยตรี', 'ร้อยโท', 'ร้อยเอก', 'ด.ช.', 'ด.ญ.'];
const ROOT_STRUCTURE = 'สำนักงานปลัดกระทรวงการคลัง';

function readSecret(name) {
  const f = path.join(SECRETS, name);
  if (!fs.existsSync(f)) throw new Error('missing ' + f);
  const v = fs.readFileSync(f, 'utf8').trim();
  if (!v) throw new Error('empty secrets file: ' + f);
  return v;
}

function extractRows(body) {
  if (Array.isArray(body)) return body;
  for (const k of ['data', 'listReturn', 'list']) if (Array.isArray(body[k])) return body[k];
  return null;
}

function buildTree(structRows) {
  const map = new Map();
  for (const s of structRows || []) map.set(s.id, s);
  return map;
}

// walk from a structure up to the top-level division (parentId === 3)
function hierarchy(tree, structureId) {
  const chain = [];
  let node = tree.get(structureId);
  let guard = 0;
  while (node && guard++ < 12) {
    chain.unshift((node.structureName || node.name || '').trim());
    if (node.parentId === 3) break;
    node = tree.get(node.parentId);
  }
  return chain; // [division, subdiv1, subdiv2, ...]
}

function toLegacy(r, idx, tree, photoPath) {
  const full = (r.fullName || '').trim();
  const prename = HONORIFICS.find(h => full.startsWith(h)) || '';
  const isFemale = /^(นาง|ด\.ญ)/.test(prename);
  const isMale = prename && !isFemale;
  const group = (r.officerGroupLabel || '').trim();
  const pos = (r.careerPosition || (r.position && r.position.positionName) || '').trim();
  const chain = hierarchy(tree, r.structure && r.structure.id);
  const division = chain[0] || group;

  return {
    seq: idx + 1,
    id: r.id,
    name: full,
    prename_th: prename,
    per_name: (r.firstName || '').trim(),
    per_surname: (r.lastName || '').trim(),
    gender: isFemale ? 'หญิง' : (isMale ? 'ชาย' : ''),
    POSITION: pos,
    position: pos,
    department: ROOT_STRUCTURE,
    division: division,
    subdiv1: chain[1] || '',
    subdiv2: chain[2] || '',
    group: group,
    unit: chain.slice(3).join(' '),
    levelname_th: group,
    email: (r.email || '').trim(),
    phone: r.tel || '',
    photo: photoPath,
  };
}

// photos are resolved through the app's own API (see lib-photos.js)

(async () => {
  const user = readSecret('EOFFICE_USER.txt');
  const pass = readSecret('EOFFICE_PASS.txt');
  const replace = process.argv.includes('--replace');
  const noPhotos = process.argv.includes('--no-photos');

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ locale: 'th-TH', viewport: { width: 1500, height: 950 } });
  const page = await ctx.newPage();

  let captured = null;
  let structures = null;
  let authToken = null;
  const seenApis = [];
  page.on('request', (req) => {
    if (authToken) return;
    const t = req.headers()['px-auth-token'];
    if (t && /mof_api/.test(req.url())) authToken = t;
  });
  page.on('response', async (res) => {
    const u = res.url();
    if (!/officerRegistry/.test(u)) return;
    seenApis.push(res.status() + ' ' + u.slice(0, 100));
    try {
      const raw = await res.body();
      const body = JSON.parse(raw.toString('utf8'));
      if (u.includes(STRUCT_MATCH)) {
        const rows = extractRows(body);
        if (rows) structures = rows;
        return;
      }
      if (!u.includes(API_MATCH)) return;
      const rows = extractRows(body);
      if (rows && rows.length) captured = rows;
    } catch (e) {
      seenApis.push('PARSE_FAIL ' + e.message);
    }
  });

  try {
    await page.goto(SIGN_IN, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForSelector('input[placeholder="ชื่อผู้ใช้งาน"]', { timeout: 30000 });
    await page.fill('input[placeholder="ชื่อผู้ใช้งาน"]', user);
    await page.fill('input[placeholder="รหัสผ่าน"]', pass);
    await page.click('button[type="submit"]:has-text("เข้าสู่ระบบ")');
    const inApp = await page.waitForFunction(() => !location.href.includes('/sign-in'), { timeout: 40000 })
      .then(() => true).catch(() => false);
    if (!inApp) throw new Error('login failed (still on sign-in page)');

    await page.goto(OFFICERS, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('button:has-text("แสดงรายชื่อ")', { timeout: 45000 });
    await page.waitForTimeout(5000);
    const btn = page.locator('button:has-text("แสดงรายชื่อ")').first();
    await btn.scrollIntoViewIfNeeded().catch(() => {});
    await btn.click({ timeout: 20000 }).catch(() => {});

    for (let i = 0; i < 20 && !captured; i++) await page.waitForTimeout(1000);
    if (!captured) {
      await btn.click({ timeout: 20000, force: true }).catch(() => {});
      for (let i = 0; i < 25 && !captured; i++) await page.waitForTimeout(1000);
    }
    if (!captured) {
      const txt = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 200)).catch(() => '');
      throw new Error('roster API not captured | ' + seenApis.join(' ; ') + ' | page: ' + txt);
    }

    const tree = buildTree(structures || []);
    if (!tree.size) console.warn('warning: structure tree empty — division falls back to group label');

    const mapped = captured.map((r, i) => toLegacy(r, i, tree, ''));

    // reuse photos already on disk (they rarely change) to keep refreshes fast
    if (fs.existsSync(OUT)) {
      try {
        const prev = JSON.parse(fs.readFileSync(OUT, 'utf8'));
        const byId = new Map(prev.map((p) => [p.id, p.photo]));
        let reused = 0;
        for (const p of mapped) {
          const photo = byId.get(p.id);
          if (photo && fs.existsSync(path.join(ROOT, photo))) { p.photo = photo; reused++; }
        }
        console.log('reused photos from previous run:', reused);
      } catch (e) { /* ignore */ }
    }

    if (!noPhotos) {
      if (!authToken) console.warn('warning: no px-auth-token captured, skipping photos');
      else {
        console.log('downloading photos for', mapped.length, 'people...');
        const res = await fetchPhotosApi(authToken, mapped, { log: (m) => console.log(m) });
        console.log('photos:', res.total, '| new:', res.found, '| none:', res.missing);
      }
    }

    fs.mkdirSync(RAW_DIR, { recursive: true });
    fs.writeFileSync(path.join(RAW_DIR, `officers-${new Date().toISOString().slice(0, 10)}.json`), JSON.stringify(captured));
    if (structures) fs.writeFileSync(path.join(RAW_DIR, 'structures.json'), JSON.stringify(structures));

    fs.writeFileSync(OUT, JSON.stringify(mapped, null, 2), 'utf8');
    if (replace) fs.writeFileSync(path.join(ROOT, 'officials_504.json'), JSON.stringify(mapped, null, 2), 'utf8');

    const withGender = mapped.filter(m => m.gender).length;
    const withPhoto = mapped.filter(m => m.photo).length;
    const mappedDiv = mapped.filter(m => m.division && m.division !== m.group).length;
    console.log('OK people:', mapped.length, '| gender:', withGender, '| photos:', withPhoto, '| structure-mapped divisions:', mappedDiv);
    console.log('wrote:', OUT, replace ? '+ officials_504.json' : '');
    console.log('sample:', JSON.stringify(mapped.find(m => m.photo) || mapped[0]));
  } finally {
    await browser.close().catch(() => {});
  }
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });