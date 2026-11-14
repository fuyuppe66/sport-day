// Direct API access using the app's own signed-parameter scheme, no browser.
// p = base64url(MD5(exp + " " + KEY)), e = exp (unix seconds)
const crypto = require('crypto');

const BASE = 'https://eoffice.vayupak.net';
const KEY = 'px.Secure.Link';
const TTL = 15;

function signedQuery() {
  const e = String(Math.floor(Date.now() / 1000) + TTL);
  const md5 = crypto.createHash('md5').update(`${e} ${KEY}`).digest();
  const p = md5.toString('base64url');
  return `p=${p}&e=${e}`;
}

async function apiGet(path, opts = {}) {
  const sep = path.includes('?') ? '&' : '?';
  const url = `${BASE}${path}${sep}${signedQuery()}`;
  const res = await fetch(url, { headers: opts.headers || {} });
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch (e) {}
  return { status: res.status, body, text: text.slice(0, 300) };
}

(async () => {
  const tests = [
    '/mof_api/v1/officerRegistry/officers?structureId=3',
    '/mof_api/v1/officerRegistry/structures?rootId=3',
    '/mof_api/v1/userProfiles/3326',
    '/mof_api/v1/userProfiles/382',
  ];
  for (const t of tests) {
    const r = await apiGet(t);
    const n = r.body && (Array.isArray(r.body) ? r.body.length : Array.isArray(r.body.data) ? r.body.data.length : Object.keys(r.body).length);
    console.log(t, '->', r.status, 'body:', n, r.status !== 200 ? r.text : '');
  }
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });