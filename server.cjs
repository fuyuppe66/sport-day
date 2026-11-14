// Production HTTP server for the สุ่มแบ่งกลุ่ม 4 สี app.
// Zero dependencies: Node core only. Serves the static pages plus the
// api/*.js handlers (same contract as the Vercel functions), with a
// writable state directory supplied by env (SPORT_STATE_DIR) so a Docker
// volume survives container restarts.
//
// env: PORT (default 8080), HOST (default 0.0.0.0), STATE_DIR (/var/lib/sport-state)
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const os = require('os');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
const STATE_DIR = process.env.STATE_DIR || path.join(os.tmpdir(), 'sport-state');
const AVATAR_DIR = path.join(STATE_DIR, 'avatars');
const API_DIR = path.join(ROOT, 'api');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};
const COMPRESSIBLE = new Set(['.html', '.css', '.js', '.json', '.svg']);

// Files that must never be served even if they land in the image.
const DENY = [
  /(^|\/)\./,                    // dotfiles and dot-directories
  /\.php$/i,
  /^\/server\.cjs$/,
  /^\/package(-lock)?\.json$/,
  /^\/jsconfig\.json$/,
  /^\/(api|dev|scripts|deploy)\//,
  /^\/(Dockerfile|docker-compose\.ya?ml)/,
];

function deny(p) {
  return DENY.some((re) => re.test(p));
}

function send(res, code, body, headers) {
  res.writeHead(code, Object.assign({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' }, headers));
  res.end(body);
}

function securityHeaders(extra) {
  return Object.assign(
    {
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
      'X-Frame-Options': 'SAMEORIGIN',
    },
    extra
  );
}

function serveFile(req, res, filePath, cacheControl) {
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'not found', securityHeaders({ 'Content-Type': 'text/plain; charset=utf-8' }));

    const etag = 'W/"' + st.size.toString(16) + '-' + Math.floor(st.mtimeMs).toString(16) + '"';
    const headers = securityHeaders({
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Last-Modified': st.mtime.toUTCString(),
      ETag: etag,
      'Cache-Control': cacheControl,
    });

    if (req.headers['if-none-match'] === etag) return send(res, 304, '', headers);

    const ext = path.extname(filePath).toLowerCase();
    const acceptsGzip = /\bgzip\b/.test(String(req.headers['accept-encoding'] || '')) && COMPRESSIBLE.has(ext) && st.size > 1024;
    if (acceptsGzip) {
      headers['Content-Encoding'] = 'gzip';
      headers.Vary = 'Accept-Encoding';
      res.writeHead(200, headers);
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(filePath).pipe(zlib.createGzip({ level: 6 })).pipe(res);
      return;
    }

    headers['Content-Length'] = st.size;
    res.writeHead(200, headers);
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(filePath).pipe(res);
  });
}

function readBody(req, limitBytes) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limitBytes) {
        reject(new Error('payload too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  let pathname = '/';
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch (e) {
    return send(res, 400, 'bad request', { 'Content-Type': 'text/plain; charset=utf-8' });
  }

  // k8s / docker health probes
  if (pathname === '/healthz') {
    return send(res, 200, JSON.stringify({ status: 'ok', uptime: Math.round(process.uptime()) }), {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
  }
  if (pathname === '/readyz') {
    let writable = false;
    try {
      fs.mkdirSync(AVATAR_DIR, { recursive: true });
      const probe = path.join(STATE_DIR, '.ready');
      fs.writeFileSync(probe, '1');
      fs.unlinkSync(probe);
      writable = true;
    } catch (e) {}
    return send(res, writable ? 200 : 503, JSON.stringify({ ready: writable, state_dir: STATE_DIR }), {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
  }

  // Avatars live on the writable volume, not in the image.
  if (pathname.startsWith('/uploads/avatars/')) {
    const name = path.basename(pathname);
    if (!/^avatar_[A-Za-z0-9_-]+\.[A-Za-z0-9]+$/.test(name)) return send(res, 404, 'not found');
    return serveFile(req, res, path.join(AVATAR_DIR, name), 'public, max-age=31536000, immutable');
  }

  // /api/<name> -> api/<name>.js (Vercel-style default export)
  if (pathname.startsWith('/api/')) {
    const name = pathname.slice(5).replace(/\/+$/, '');
    if (!/^[a-z0-9_-]+$/i.test(name)) return send(res, 404, 'api not found');
    const file = path.join(API_DIR, name + '.js');
    if (!fs.existsSync(file)) return send(res, 404, 'api not found: ' + name);

    // Guard oversized bodies (avatar uploads arrive as base64 JSON).
    if (req.method === 'POST' && Number(req.headers['content-length'] || 0) > 25 * 1024 * 1024) {
      return send(res, 413, JSON.stringify({ success: false, message: 'payload too large' }), {
        'Content-Type': 'application/json; charset=utf-8',
      });
    }

    try {
      delete require.cache[require.resolve(file)];
      const handler = require(file);
      await handler(req, res);
    } catch (e) {
      console.error('[api:' + name + ']', e && e.message);
      if (!res.headersSent) {
        send(res, 500, JSON.stringify({ success: false, message: 'handler error' }), {
          'Content-Type': 'application/json; charset=utf-8',
        });
      } else {
        res.end();
      }
    }
    console.log(req.method, pathname, res.statusCode, Date.now() - started + 'ms');
    return;
  }

  if (deny(pathname)) return send(res, 404, 'not found', { 'Content-Type': 'text/plain; charset=utf-8' });

  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const filePath = path.resolve(ROOT, rel);
  if (!filePath.startsWith(ROOT + path.sep) && filePath !== ROOT) {
    return send(res, 404, 'not found', { 'Content-Type': 'text/plain; charset=utf-8' });
  }

  // HTML must revalidate so a redeploy is visible immediately; assets are immutable-ish.
  const ext = path.extname(filePath).toLowerCase();
  const cache = ext === '.html' ? 'no-cache' : 'public, max-age=86400';
  serveFile(req, res, filePath, cache);
});

server.keepAliveTimeout = 65000;
server.headersTimeout = 70000;

server.listen(PORT, HOST, () => {
  try {
    fs.mkdirSync(AVATAR_DIR, { recursive: true });
  } catch (e) {}
  console.log('sport-spin listening on http://' + HOST + ':' + PORT + ' (STATE_DIR=' + STATE_DIR + ')');
});

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    console.log('received ' + sig + ', draining connections');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 8000).unref();
  });
}