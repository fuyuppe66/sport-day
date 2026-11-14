// Probe: does the officers API need a session? Where do photos live?
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
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ locale: 'th-TH' });
  const page = await ctx.newPage();

  let officersUrl = null, officersBody = null;
  page.on('response', async (res) => {
    if (!res.url().includes('/officerRegistry/officers')) return;
    try {
      officersBody = await res.json();
      officersUrl = res.url();
    } catch (e) {}
  });

  // login + trigger the roster API
  await page.goto(BASE + '/sign-in?redirectURL=%2Fmwp%2Flist-officers', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input[placeholder="ชื่อผู้ใช้งาน"]', { timeout: 30000 });
  await page.fill('input[placeholder="ชื่อผู้ใช้งาน"]', USER);
  await page.fill('input[placeholder="รหัสผ่าน"]', PASS);
  await page.click('button[type="submit"]:has-text("เข้าสู่ระบบ")');
  await page.waitForFunction(() => !location.href.includes('/sign-in'), { timeout: 40000 });
  await page.goto(BASE + '/mwp/list-officers', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  await page.locator('button:has-text("แสดงรายชื่อ")').first().click();
  for (let i = 0; i < 25 && !officersBody; i++) await page.waitForTimeout(1000);
  if (!officersBody) throw new Error('roster API not captured');

  const rows = officersBody.data || officersBody.listReturn || officersBody.list || officersBody;
  console.log('AUTH_DETAILS:', JSON.stringify(Array.isArray(rows) ? rows.length : 'n/a'));

  // 1) same URL WITHOUT cookies
  const anon = await browser.newContext();
  const r1 = await anon.request.get(officersUrl, { failOnStatusCode: false });
  console.log('NO_COOKIE same-url:', r1.status(), (await r1.text()).slice(0, 120));
  const r2 = await anon.request.get(BASE + '/mof_api/v1/officerRegistry/officers?structureId=3', { failOnStatusCode: false });
  console.log('NO_COOKIE no-signature:', r2.status(), (await r2.text()).slice(0, 120));

  // 2) detail + photo candidates for one officer
  const sample = rows[0];
  const id = sample.id;
  console.log('sample id:', id, 'keys:', Object.keys(sample).join(','));

  const candidates = [
    `/mof_api/v1/officerRegistry/officers/${id}`,
    `/mof_api/v1/officerRegistry/officers/${id}?version=1`,
    `/mof_api/v1/userProfiles/${id}`,
    `/mof_api/v1/userProfiles/${id}/image`,
    `/mof_api/v1/userProfiles/${id}/photo`,
    `/mof_api/v1/userProfiles/${id}/imageProfile`,
    `/mof_api/v1/userProfiles/images/${id}`,
    `/mof_api/v1/officerRegistry/officers/${id}/image`,
    `/mof_api/v1/userProfiles/${id}/avatar`,
  ];
  for (const c of candidates) {
    const r = await page.request.get(BASE + c, { failOnStatusCode: false });
    const ct = r.headers()['content-type'] || '';
    let note = '';
    if (/json/.test(ct)) {
      const t = await r.text();
      try { const j = JSON.parse(t); note = 'keys=' + Object.keys(j).join(',') + ' | sub=' + JSON.stringify(j.data).slice(0, 160); }
      catch { note = t.slice(0, 100); }
    } else {
      note = ct + ' | ' + (await r.body()).length + 'b';
    }
    console.log(c, '->', r.status(), note.slice(0, 260));
  }

  await browser.close();
})().catch(e => { console.error('FAILED:', e.message.split('\n')[0]); process.exit(1); });