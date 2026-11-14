// Local dev server that mimics Vercel: static files + /api/* -> Node functions.
// Usage: npm run dev  (or node dev/server.cjs), then open http://localhost:8090
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch (e) { pathname = url.pathname; }

  // /api/<name> -> api/<name>.js (Vercel function handler)
  if (pathname.startsWith('/api/')) {
    const name = pathname.slice(5).split('?')[0];
    const file = path.join(ROOT, 'api', name + '.js');
    if (!fs.existsSync(file)) {
      res.statusCode = 404;
      return res.end('api not found: ' + name);
    }
    const handler = require(file);
    handler(req, res).catch((e) => {
      res.statusCode = 500;
      res.end('handler error: ' + e.message);
    });
    return;
  }

  // Static
  let p = pathname === '/' ? '/index.html' : pathname;
  const fp = path.normalize(path.join(ROOT, p));
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
    res.statusCode = 404;
    return res.end('not found: ' + pathname);
  }
  res.setHeader('Content-Type', MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream');
  res.end(fs.readFileSync(fp));
});

const port = process.env.PORT || 8090;
server.listen(port, () => {
  console.log('Sport spin dev server (Vercel emulator): http://localhost:' + port);
});
