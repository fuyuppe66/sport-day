// Explore /mwp/list-officers: click "แสดงรายชื่อ" and capture the data source (JSON API or table).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');

const AUTH = path.join(os.homedir(), '.secrets', 'eoffice-auth.json');
const OUT = path.join(os.homedir(), '.secrets', 'officers-raw.json');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ storageState: AUTH, locale: 'th-TH' });
  const page = await ctx.newPage();

  const apis = [];
  page.on('response', async (res) => {
    const url = res.url();
    const ct = (res.headers()['content-type'] || '');
    if (!/json|javascript/.test(ct)) return;
    if (/\.js(\?|$)|hot-update|assets\//.test(url)) return;
    try {
      const body = await res.json();
      const shape = Array.isArray(body)
        ? { kind: 'array', len: body.length, sampleKeys: body[0] ? Object.keys(body[0]).slice(0, 30) : [] }
        : { kind: 'object', keys: Object.keys(body).slice(0, 30) };
      apis.push({ url, status: res.status(), size: JSON.stringify(body).length, shape });
      if (url.includes('sport') || /officer|personnel|list|report|search/i.test(url)) {
        fs.writeFileSync(OUT, JSON.stringify(body, null, 2));
      }
    } catch (e) {}
  });

  await page.goto('https://eoffice.vayupak.net/mwp/list-officers', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(6000);

  const before = await page.evaluate(() => ({
    url: location.href,
    title: document.title,
    inputs: [...document.querySelectorAll('input')].map(i => i.placeholder || i.name || i.type).slice(0, 12),
    buttons: [...document.querySelectorAll('button')].map(b => (b.innerText || '').trim().slice(0, 40)).filter(Boolean).slice(0, 15),
    rows: document.querySelectorAll('table tbody tr').length,
    bodySample: document.body.innerText.replace(/\s+/g, ' ').slice(0, 200),
  }));

  // click the run button
  let clicked = false;
  for (const sel of ['button:has-text("แสดงรายชื่อ")', 'button:has-text("แสดงรายชื่อบุคลากร")']) {
    const loc = page.locator(sel).first();
    if (await loc.count()) { await loc.click({ timeout: 15000 }).then(() => { clicked = true; }).catch(() => {}); break; }
  }
  if (!clicked) {
    const txt = await page.evaluate(() => [...document.querySelectorAll('a,button')].map(e => (e.innerText || '').trim()).filter(Boolean).slice(0, 30));
    console.log('BUTTON NOT FOUND. Clickables:', JSON.stringify(txt));
  }
  await page.waitForTimeout(9000);

  const after = await page.evaluate(() => ({
    url: location.href,
    rows: document.querySelectorAll('table tbody tr').length,
    tables: document.querySelectorAll('table').length,
    selectHeaders: [...document.querySelectorAll('table thead th')].map(t => (t.innerText || '').trim()).slice(0, 12),
    firstRow: [...(document.querySelector('table tbody tr')?.children || [])].map(c => c.innerText.trim()).slice(0, 8),
    bodySample: document.body.innerText.replace(/\s+/g, ' ').slice(0, 300),
  }));

  console.log(JSON.stringify({ before, clicked, after, apis: apis.slice(-25) }, null, 2));
  console.log('RAW SAVED:', fs.existsSync(OUT) ? OUT + ' (' + fs.statSync(OUT).size + ' bytes)' : 'none');
  await browser.close();
})();