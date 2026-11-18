// fetch-office.js — pull the roster of a *second* eoffice unit (e.g. สำนักงานรัฐมนตรี)
// and write it as an extra roster file the app can merge in.
//
// The eoffice page /mwp/list-officers has a mat-radio-group ของ "กลุ่มหน่วยงาน":
//   value 3 = สำนักงานปลัดกระทรวงการคลัง   (officials_live.json)
//   value 2 = สำนักงานรัฐมนตรีกระทรวงการคลัง (officials_office2.json)
//
// Usage: node scripts/fetch-office.js [--structure=2] [--label="..."] [--out=officials_office2.json] [--no-photos]
// Credentials: ~/.secrets/EOFFICE_USER.txt + EOFFICE_PASS.txt (read, never printed).
const fs = require('fs');
const os = require('os');
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) { ({ chromium } = require(path.join(os.homedir(), 'mcp', 'playwright', 'node_modules', 'playwright'))); }

const SECRETS = path.join(os.homedir(), '.secrets');
const ROOT = path.join(__dirname, '..');
const { fetchPhotos: fetchPhotosApi } = require('./lib-photos.js');

const BASE = 'https://eoffice.vayupak.net';
const SIGN_IN = BASE + '/sign-in?redirectURL=%2Fmwp%2Flist-officers';
const OFFICERS = BASE + '/mwp/list-officers';

const arg = (name, def) => {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : def;
};
const STRUCTURE_ID = String(arg('structure', '2'));
const LABEL = arg('label', 'สำนักงานรัฐมนตรีกระทรวงการคลัง');
const OUT = path.join(ROOT, arg('out', `officials_office${STRUCTURE_ID}.json`));
const NO_PHOTOS = process.argv.includes('--no-photos');

const HONORIFICS = ['นางสาว', 'นาง', 'นาย', 'ว่าที่ร้อยตรี', 'ร้อยตรี', 'ร้อยโท', 'ร้อยเอก', 'ด.ช.', 'ด.ญ.'];

const readSecret = (n) => {
  const f = path.join(SECRETS, n);
  if (!fs.existsSync(f)) throw new Error('missing ' + f);
  return fs.readFileSync(f, 'utf8').trim();
};

function extractRows(body) {
  if (!body) return null;
  if (Array.isArray(body)) return body;
  for (const k of ['data', 'content', 'items', 'results', 'officers']) {
    const v = body[k];
    if (Array.isArray(v)) return v;
    if (v && Array.isArray(v.content)) return v.content;
    if (v && Array.isArray(v.data)) return v.data;
  }
  return null;
}

function buildTree(rows) {
  const m = new Map();
  for (const r of rows || []) {
    const id = r.id ?? r.structureId;
    if (id !== undefined) m.set(id, r);
  }
  return m;
}

// walk up until we leave the tree (root of this unit) — max 12 hops
function hierarchy(tree, sid, rootId) {
  const chain = [];
  let node = tree.get(sid);
  let guard = 0;
  while (node && guard++ < 12) {
    chain.unshift((node.structureName || node.name || '').trim());
    const parent = node.parentId;
    if (parent === undefined || parent === null) break;
    if (rootId !== undefined && String(parent) === String(rootId)) break;
    const next = tree.get(parent);
    if (!next) break;
    node = next;
  }
  return chain;
}

function toLegacy(r, idx, tree, rootId) {
  const full = (r.fullName || '').trim();
  const prename = HONORIFICS.find(h => full.startsWith(h)) || '';
  const isFemale = /^(นาง|ด\.ญ)/.test(prename);
  const isMale = prename && !isFemale;
  const group = (r.officerGroupLabel || '').trim();
  const pos = (r.careerPosition || (r.position && r.position.positionName) || '').trim();
  const chain = hierarchy(tree, r.structure && r.structure.id, rootId);
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
    // ทั้งหน่วยงานถือเป็นกรอบ "สำนัก" เดียว — ส่วนงานย่อยมาจากฝ่าย/กลุ่มงาน
    department: LABEL,
    division: LABEL,
    subdiv1: chain[0] || group || 'ไม่ระบุส่วนงาน',
    subdiv2: chain[1] || '',
    group: group,
    unit: chain.slice(2).join(' '),
    levelname_th: group,
    email: (r.email || '').trim(),
    phone: r.tel || '',
    photo: '',
    officeId: Number(STRUCTURE_ID),
  };
}

(async () => {
  const user = readSecret('EOFFICE_USER.txt');
  const pass = readSecret('EOFFICE_PASS.txt');

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ locale: 'th-TH', viewport: { width: 1500, height: 950 } });
  const page = await ctx.newPage();

  let captured = null, structures = null, authToken = null;
  const seen = [];
  page.on('request', (req) => {
    if (authToken) return;
    const t = req.headers()['px-auth-token'];
    if (t && /mof_api/.test(req.url())) authToken = t;
  });
  page.on('response', async (res) => {
    const u = res.url();
    if (!/officerRegistry/.test(u)) return;
    seen.push(res.status() + ' ' + u.slice(0, 90));
    try {
      const body = JSON.parse((await res.body()).toString('utf8'));
      if (u.includes('/structures')) {
        if (String(u).includes(`rootId=${STRUCTURE_ID}`)) structures = extractRows(body) || structures;
        return;
      }
      if (!/officerRegistry\/officers/.test(u)) return;
      if (!String(u).includes(`structureId=${STRUCTURE_ID}`)) return;
      const rows = extractRows(body);
      if (rows && rows.length) captured = rows;
    } catch (e) {}
  });

  try {
    await page.goto(SIGN_IN, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForSelector('input[placeholder="ชื่อผู้ใช้งาน"]', { timeout: 30000 });
    await page.fill('input[placeholder="ชื่อผู้ใช้งาน"]', user);
    await page.fill('input[placeholder="รหัสผ่าน"]', pass);
    await page.click('button[type="submit"]:has-text("เข้าสู่ระบบ")');
    const ok = await page.waitForFunction(() => !location.href.includes('/sign-in'), { timeout: 40000 }).then(() => true).catch(() => false);
    if (!ok) throw new Error('login failed');

    await page.goto(OFFICERS, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('button:has-text("แสดงรายชื่อ")', { timeout: 45000 });
    await page.waitForTimeout(4000);

    // เลือก "กลุ่มหน่วยงาน" ตาม radio value ที่ต้องการ
    const radio = page.locator(`input[type="radio"][value="${STRUCTURE_ID}"]`).first();
    if (await radio.count()) {
      await radio.check({ force: true }).catch(async () => { await radio.click({ force: true }).catch(() => {}); });
      console.log('selected office radio:', STRUCTURE_ID, LABEL);
    } else {
      console.warn('radio for structure', STRUCTURE_ID, 'not found — keeping default selection');
    }
    await page.waitForTimeout(2500);

    const btn = page.locator('button:has-text("แสดงรายชื่อ")').first();
    await btn.scrollIntoViewIfNeeded().catch(() => {});
    await btn.click({ timeout: 20000 }).catch(() => {});
    for (let i = 0; i < 20 && !captured; i++) await page.waitForTimeout(1000);
    if (!captured) {
      await btn.click({ timeout: 20000, force: true }).catch(() => {});
      for (let i = 0; i < 20 && !captured; i++) await page.waitForTimeout(1000);
    }
    if (!captured) throw new Error('roster not captured | ' + seen.join(' ; '));

    const tree = buildTree(structures || []);
    const mapped = captured.map((r, i) => toLegacy(r, i, tree, STRUCTURE_ID));

    if (!NO_PHOTOS && authToken) {
      console.log('downloading photos for', mapped.length, 'people...');
      const res = await fetchPhotosApi(authToken, mapped, { log: (m) => console.log(m) });
      console.log('photos:', res.total, '| new:', res.found, '| none:', res.missing);
    } else if (!authToken) {
      console.warn('no px-auth-token captured — skipping photos');
    }

    fs.mkdirSync(path.join(SECRETS, 'raw'), { recursive: true });
    fs.writeFileSync(path.join(SECRETS, 'raw', `officers-office${STRUCTURE_ID}-${new Date().toISOString().slice(0, 10)}.json`), JSON.stringify(captured));
    if (structures) fs.writeFileSync(path.join(SECRETS, 'raw', `structures-office${STRUCTURE_ID}.json`), JSON.stringify(structures));

    fs.writeFileSync(OUT, JSON.stringify(mapped, null, 2), 'utf8');
    const withPhoto = mapped.filter(m => m.photo).length;
    const divisions = new Set(mapped.map(m => m.division));
    console.log('OK people:', mapped.length, '| photos:', withPhoto, '| divisions:', divisions.size);
    console.log('divisions:', [...divisions].join(' | '));
    console.log('wrote:', OUT);
  } finally {
    await browser.close().catch(() => {});
  }
})();
