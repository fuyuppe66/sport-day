// eoffice-login.js — logs into eoffice.vayupak.net and saves the session (auth.json).
// Credentials are read from ~/.secrets/*.txt at runtime and never printed.
// Usage: node scripts/eoffice-login.js [--headed]
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
const USER_FILE = path.join(SECRETS, 'EOFFICE_USER.txt');
const PASS_FILE = path.join(SECRETS, 'EOFFICE_PASS.txt');
const AUTH_FILE = path.join(SECRETS, 'eoffice-auth.json');

const SIGN_IN = 'https://eoffice.vayupak.net/sign-in?redirectURL=%2Fnew_portal';
const PORTAL = 'https://eoffice.vayupak.net/new_portal';

function readSecret(file, label) {
  if (!fs.existsSync(file)) throw new Error(`missing ${file}`);
  const v = fs.readFileSync(file, 'utf8').trim();
  if (!v) throw new Error(`${label} file is empty: ${file}`);
  return v;
}

(async () => {
  const headed = process.argv.includes('--headed');
  const user = readSecret(USER_FILE, 'username');
  const pass = readSecret(PASS_FILE, 'password');

  const browser = await chromium.launch({ headless: !headed });
  const ctx = await browser.newContext({ locale: 'th-TH' });
  const page = await ctx.newPage();

  let stage = 'open sign-in page';
  try {
    await page.goto(SIGN_IN, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForSelector('input[formcontrolname="name"], input[placeholder="ชื่อผู้ใช้งาน"]', { timeout: 30000 });

    stage = 'fill credentials';
    await page.fill('input[placeholder="ชื่อผู้ใช้งาน"]', user);
    await page.fill('input[placeholder="รหัสผ่าน"]', pass);

    stage = 'submit';
    await Promise.all([
      page.waitForLoadState('domcontentloaded', { timeout: 45000 }).catch(() => {}),
      page.click('button[type="submit"]:has-text("เข้าสู่ระบบ")'),
    ]);

    // Wait for the SPA to leave the sign-in route
    stage = 'await portal';
    const ok = await page.waitForFunction(
      () => !location.href.includes('/sign-in'),
      { timeout: 30000 }
    ).then(() => true).catch(() => false);

    const url = page.url();
    const text = (await page.evaluate(() => document.body.innerText).catch(() => '')) || '';
    const loggedIn = ok && !url.includes('/sign-in');
    const errHint = text.toLowerCase().includes('ไม่ถูกต้อง') || text.includes('รหัสผ่านไม่ถูกต้อง');

    if (!loggedIn) {
      console.error('LOGIN FAILED — still on', url);
      if (errHint) console.error('site shows an invalid-credentials message');
      console.error('page text sample:', text.replace(/\s+/g, ' ').slice(0, 200));
      await browser.close();
      process.exit(2);
    }

    stage = 'verify portal';
    await page.goto(PORTAL, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(4000);
    const portalUrl = page.url();

    fs.mkdirSync(SECRETS, { recursive: true });
    await ctx.storageState({ path: AUTH_FILE });

    console.log('LOGIN OK');
    console.log('landed:', portalUrl);
    console.log('session saved:', AUTH_FILE, `(${fs.statSync(AUTH_FILE).size} bytes)`);
    await browser.close();
  } catch (e) {
    console.error(`FAILED at stage "${stage}":`, e.message.split('\n')[0]);
    await browser.close().catch(() => {});
    process.exit(1);
  }
})();