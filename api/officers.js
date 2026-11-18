// /api/officers — live roster from the eoffice registry API, with ages merged in.
//
// The PHP app only ever read JSON files off disk; this is the same roster pulled
// from eoffice itself (the signed-parameter scheme the web app uses:
// p = base64url(MD5(exp + " " + KEY)), e = exp in unix seconds, TTL 15s).
//
//   GET /api/officers              -> live from eoffice, ages merged
//   GET /api/officers?source=local -> officials_live.json + ages (no network)
//   GET /api/officers?ages=0       -> skip the age merge
//   GET /api/officers?structureId=3
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const BASE = 'https://eoffice.vayupak.net';
const KEY = 'px.Secure.Link';
const TTL = 15;
const CACHE_MS = 120000;

const ROOT = path.join(__dirname, '..');
const CACHE = { at: 0, key: '', body: null };

function signedQuery() {
  const e = String(Math.floor(Date.now() / 1000) + TTL);
  const p = crypto.createHash('md5').update(`${e} ${KEY}`).digest().toString('base64url');
  return `p=${p}&e=${e}`;
}

function norm(s) {
  return String(s || '').normalize('NFC').replace(/\s+/g, '').replace(/^(นางสาว|นาง|นาย|ด\.ช\.|ด\.ญ\.)/, '');
}

function readJson(name) {
  const candidates = [path.join(ROOT, name), path.join(ROOT, 'compare', name)];
  for (const p of candidates) {
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) {}
  }
  return null;
}

// ages come from the seminar roster (seminar_users.json / officials_ages.json)
function ageIndex() {
  const idx = { byName: {}, bySeq: {} };
  const seminar = readJson('officials_seminar.json');
  if (Array.isArray(seminar)) {
    for (const u of seminar) {
      if (typeof u.age !== 'number') continue;
      // name only: the seminar roster's `seq` is its own 1..N numbering, not the
      // eoffice seq, so indexing by it silently pairs the wrong people.
      idx.byName[norm(u.name)] = u.age;
    }
  }
  const map = readJson('officials_ages.json');
  if (map) {
    for (const [k, v] of Object.entries(map.by_seq || {})) idx.bySeq[k] = v;
    for (const [k, v] of Object.entries(map.by_name || {})) if (idx.byName[k] === undefined) idx.byName[k] = v;
  }
  return idx;
}

function normalise(raw) {
  if (Array.isArray(raw)) return raw;
  if (!raw) return [];
  for (const k of ['officers', 'data', 'items', 'results']) {
    if (Array.isArray(raw[k])) return raw[k];
    if (raw[k] && Array.isArray(raw[k].officers)) return raw[k].officers;
  }
  return [];
}

async function fromEoffice(structureId) {
  const url = `${BASE}/mof_api/v1/officerRegistry/officers?structureId=${encodeURIComponent(structureId)}&${signedQuery()}`;
  const headers = { accept: 'application/json' };
  // eoffice also wants the web app's session token; keep it out of the repo:
  //   EOFFICE_TOKEN=<value>   or   EOFFICE_TOKEN_FILE=~/.secrets/eoffice_token.txt
  let token = process.env.EOFFICE_TOKEN || '';
  if (!token && process.env.EOFFICE_TOKEN_FILE) {
    try { token = fs.readFileSync(process.env.EOFFICE_TOKEN_FILE, 'utf8').trim(); } catch (e) {}
  }
  if (token) headers['px-auth-token'] = token;
  const res = await fetch(url, { headers });
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch (e) {}
  if (!res.ok || !body) {
    const err = new Error(`eoffice responded ${res.status}`);
    err.detail = text.slice(0, 200);
    throw err;
  }
  return normalise(body);
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  const q = new URL(req.url, 'http://localhost').searchParams;
  const structureId = q.get('structureId') || '3';
  const wantAges = q.get('ages') !== '0';
  const forceLocal = q.get('source') === 'local';
  const cacheKey = `${structureId}|${wantAges}|${forceLocal}`;

  if (CACHE.body && CACHE.key === cacheKey && Date.now() - CACHE.at < CACHE_MS) {
    res.setHeader('X-Cache', 'hit');
    res.statusCode = 200;
    return res.end(JSON.stringify(CACHE.body));
  }

  const ages = wantAges ? ageIndex() : null;
  let officers = [];
  let source = 'eoffice';
  let error = null;

  if (!forceLocal) {
    try {
      officers = await fromEoffice(structureId);
    } catch (e) {
      error = e.message + (e.detail ? ': ' + e.detail : '');
    }
  }

  if (!officers.length) {
    source = 'local';
    const local = readJson('officials_live.json') || readJson('officials_504.json') || [];
    officers = Array.isArray(local) ? local : normalise(local);
  }

  if (ages) {
    let merged = 0;
    officers = officers.map((u) => {
      const seq = u.seq;
      const name = norm(u.name || (String(u.prename_th || '') + (u.per_name || '') + (u.per_surname || '')));
      let age = null;
      if (seq !== undefined && ages.bySeq[String(seq)] !== undefined) age = ages.bySeq[String(seq)];
      else if (ages.byName[norm(name)] !== undefined) age = ages.byName[norm(name)];
      if (age === null) return u;
      merged++;
      return { ...u, age };
    });
    var agesMerged = merged;
  }

  const body = {
    source,
    structureId,
    fetchedAt: new Date().toISOString(),
    count: officers.length,
    withAge: ages ? officers.filter((u) => typeof u.age === 'number').length : undefined,
    error: error || undefined,
    officers,
  };
  CACHE.at = Date.now();
  CACHE.key = cacheKey;
  CACHE.body = body;

  res.setHeader('X-Cache', 'miss');
  res.setHeader('X-Age-Merged', String(agesMerged || 0));
  res.statusCode = 200;
  res.end(JSON.stringify(body));
};
