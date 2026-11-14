// save_state API — Vercel Node function (replaces save_state.php)
// NOTE: Vercel function filesystem is ephemeral (/tmp only), so saved state
// persists only while the container instance is alive. Cross-browser sync in
// the app is handled client-side via localStorage ('sport_shared_stage_state').
const fs = require('fs');
const path = require('path');
const os = require('os');

const DIR = process.env.STATE_DIR || path.join(os.tmpdir(), 'sport-state');
const FILE = path.join(DIR, 'latest_spin.json');

function ensureDir() {
  try { fs.mkdirSync(DIR, { recursive: true }); } catch (e) {}
}

function json(res, code, obj) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=UTF-8');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.end(JSON.stringify(obj));
}

module.exports = async function handler(req, res) {
  const method = (req.method || 'GET').toUpperCase();

  if (method === 'POST') {
    let body = '';
    for await (const chunk of req) body += chunk;
    if (body) {
      try {
        const data = JSON.parse(body);
        if (data !== null && typeof data === 'object') {
          data.updated_at = new Date().toISOString().replace('T', ' ').slice(0, 19);
          ensureDir();
          fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
          return json(res, 200, { success: true, message: 'Saved successfully' });
        }
      } catch (e) {}
    }
    return json(res, 400, { success: false, message: 'Invalid JSON' });
  }

  if (method === 'GET') {
    try {
      if (fs.existsSync(FILE)) {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json; charset=UTF-8');
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        return res.end(fs.readFileSync(FILE, 'utf8'));
      }
    } catch (e) {}
    return json(res, 200, { success: false, teams: null });
  }

  return json(res, 405, { success: false, message: 'Method not allowed' });
};
