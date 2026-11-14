// upload_avatar API — Vercel Node function (replaces upload_avatar.php)
// Accepts JSON { userId, imageBase64 } (data URL or raw base64).
// Files are also written to /tmp so the same container instance can serve
// them at list time; the response returns a data: URL so the client can
// persist the avatar in localStorage (Vercel filesystem is ephemeral).
const fs = require('fs');
const path = require('path');
const os = require('os');

const DIR = process.env.STATE_DIR ? path.join(process.env.STATE_DIR, 'avatars') : path.join(os.tmpdir(), 'sport-state', 'avatars');
const ALLOWED_EXT = ['jpg', 'jpeg', 'png', 'gif', 'webp'];

function ensureDir() {
  try { fs.mkdirSync(DIR, { recursive: true }); } catch (e) {}
}

function json(res, code, obj) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=UTF-8');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.end(JSON.stringify(obj));
}

function cleanId(s) {
  return String(s || '').replace(/[^a-zA-Z0-9_-]/g, '');
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

module.exports = async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const action = url.searchParams.get('action') || 'upload';
  const method = (req.method || 'GET').toUpperCase();

  // 1. List all avatars
  if (action === 'list') {
    const avatars = {};
    ensureDir();
    try {
      for (const f of fs.readdirSync(DIR)) {
        const m = f.match(/^avatar_([a-zA-Z0-9_-]+)\.([a-zA-Z0-9]+)$/);
        if (m) {
          let v = 0;
          try { v = Math.floor(fs.statSync(path.join(DIR, f)).mtimeMs); } catch (e) {}
          avatars[m[1]] = 'uploads/avatars/' + f + '?v=' + v;
        }
      }
    } catch (e) {}
    return json(res, 200, { success: true, avatars });
  }

  // 2. Delete avatar
  if (action === 'delete') {
    let userId = '';
    const body = await readBody(req).catch(() => '');
    try { userId = JSON.parse(body).userId; } catch (e) {}
    userId = cleanId(userId);
    if (userId) {
      ensureDir();
      try {
        for (const f of fs.readdirSync(DIR).filter((f) => f.startsWith('avatar_' + userId + '.'))) {
          try { fs.unlinkSync(path.join(DIR, f)); } catch (e) {}
        }
      } catch (e) {}
      return json(res, 200, { success: true, message: 'Deleted' });
    }
    return json(res, 400, { success: false, message: 'Invalid userId' });
  }

  // 3. Upload avatar (JSON: { userId, imageBase64 })
  if (method === 'POST') {
    const body = await readBody(req).catch(() => '');
    let payload = null;
    try { payload = JSON.parse(body); } catch (e) {}
    if (!payload || !payload.userId || !payload.imageBase64) {
      return json(res, 400, { success: false, message: 'Expected JSON { userId, imageBase64 }' });
    }
    const userId = cleanId(payload.userId);
    if (!userId) return json(res, 400, { success: false, message: 'Invalid userId' });

    let base64 = String(payload.imageBase64);
    let ext = 'png';
    const m = base64.match(/^data:image\/([\w+]+);base64,/);
    if (m) {
      base64 = base64.slice(base64.indexOf(',') + 1);
      ext = m[1].toLowerCase();
      if (ext === 'jpeg') ext = 'jpg';
      if (!ALLOWED_EXT.includes(ext)) ext = 'jpg';
    } else if (!ALLOWED_EXT.includes(ext)) {
      ext = 'png';
    }

    const data = Buffer.from(base64.replace(/\s/g, ''), 'base64');
    if (!data.length) return json(res, 400, { success: false, message: 'Invalid image data' });

    ensureDir();
    // Remove previous avatar for this user
    try {
      for (const f of fs.readdirSync(DIR).filter((f) => f.startsWith('avatar_' + userId + '.'))) {
        try { fs.unlinkSync(path.join(DIR, f)); } catch (e) {}
      }
    } catch (e) {}
    fs.writeFileSync(path.join(DIR, 'avatar_' + userId + '.' + ext), data);

    // Return a data: URL so the client can persist it in localStorage
    // (Vercel container filesystem does not persist across invocations).
    const mime = ext === 'jpg' ? 'image/jpeg' : 'image/' + ext;
    return json(res, 200, {
      success: true,
      avatarUrl: 'data:' + mime + ';base64,' + base64.replace(/\s/g, ''),
      userId,
    });
  }

  return json(res, 400, { success: false, message: 'Invalid request' });
};
