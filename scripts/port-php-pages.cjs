// One-off migration: turn the PHP pages of ../sport-2/sport into static pages for
// this Node project. The PHP only injected three window.* globals, so the port is
// (1) drop the prologue, (2) fetch the same data client-side, (3) rewrite nav links.
//
// usage: node scripts/port-php-pages.cjs <source-dir>
const fs = require('fs');
const path = require('path');

const SRC = process.argv[2] || 'C:/Users/Admin/Downloads/sport-2/sport';
const OUT = path.join(__dirname, '..', 'compare');   // everything lands in compare/ only

const BOOTSTRAP = `
    // --- data bootstrap (was PHP json_encode in the original page) ---
    window.INITIAL_USER_DATA = [];
    window.LATEST_SPIN_DATA = null;
    window.INITIAL_USER_AVATARS = {};
    window.DATA_LOADED = (async () => {
      try {
        let r = await fetch('officials_seminar.json?t=' + Date.now());
        if (r.ok) window.INITIAL_USER_DATA = await r.json();
        if (!Array.isArray(window.INITIAL_USER_DATA) || !window.INITIAL_USER_DATA.length) {
          r = await fetch('../officials_live.json?t=' + Date.now());
          if (r.ok) window.INITIAL_USER_DATA = await r.json();
        }
      } catch (e) {}
      try {
        const s = await fetch('/api/save_state');
        if (s.ok) { const d = await s.json(); if (d && d.teams) window.LATEST_SPIN_DATA = d; }
      } catch (e) {}
      try {
        const a = await fetch('/api/upload_avatar?action=list');
        if (a.ok) {
          const d = await a.json();
          if (d.avatars) {
            // the API returns 'uploads/avatars/..' (app-root relative); pages here live
            // one level down, so make every url absolute before use
            window.INITIAL_USER_AVATARS = Object.fromEntries(
              Object.entries(d.avatars).map(([k, v]) => [k, (v.startsWith('http') || v.startsWith('/')) ? v : '/' + v])
            );
          }
        }
      } catch (e) {}
      // portraits + ages from our own API, matched onto this roster by name
      // (never by seq: the seminar roster numbers people 1..332 of its own, so a
      // seq match would put somebody else's face on the card)
      try {
        const o = await fetch('/api/officers?source=local&ages=1');
        if (o.ok) {
          const d = await o.json();
          const strip = (s) => String(s || '').normalize('NFC').replace(/\\s+/g, '').replace(/^(นางสาว|นาง|นาย|ด\\.ช\\.|ด\\.ญ\\.)/, '');
          const photos = {};
          const ages = {};
          (d.officers || []).forEach((p) => {
            const nameKey = 'name_' + encodeURIComponent(p.name || '');
            const looseKey = 'n_' + strip(p.name);
            if (p.photo) {
              const url = (p.photo.startsWith('http') || p.photo.startsWith('/')) ? p.photo : '/' + p.photo;
              photos[nameKey] = url;
              photos[looseKey] = url;
            }
            if (typeof p.age === 'number') ages[strip(p.name)] = p.age;
          });
          window.OFFICER_PHOTOS = photos;
          if (Array.isArray(window.INITIAL_USER_DATA)) {
            window.INITIAL_USER_DATA.forEach((u) => {
              if (u.age === undefined || u.age === null) {
                const a2 = ages[strip(u.name)];
                if (a2 !== undefined) u.age = a2;
              }
            });
          }
        }
      } catch (e) {}
    })();
`;

function rewriteLinks(html) {
  return html
    .replace(/href="division_random\.php"/g, 'href="division_random.html"')
    .replace(/href="all_random\.php"/g, 'href="all_random.html"')
    .replace(/href="stage_random\.php"/g, 'href="../stage_random.html"')
    .replace(/href="index\.php"/g, 'href="../index.html"')
    .replace(/href="stage_random\.html"/g, 'href="../stage_random.html"')
    .replace(/href="index\.html"/g, 'href="../index.html"');
}

function makeAwaitData(html) {
  // every page kicks off work on DOMContentLoaded; wait for the fetch first
  return html.replace(
    /window\.addEventListener\('DOMContentLoaded',\s*\(\)\s*=>\s*\{/g,
    "window.addEventListener('DOMContentLoaded', async () => {\n      await window.DATA_LOADED;"
  );
}

function portDivision() {
  const src = fs.readFileSync(path.join(SRC, 'division_random.php'), 'utf8');
  const cut = src.indexOf('\n?>\n');
  if (cut < 0) throw new Error('division_random.php: prologue end not found');
  let html = src.slice(cut + 4);

  // replace the three PHP echoes with the fetch bootstrap
  const injected = /window\.INITIAL_USER_DATA = <\?php[\s\S]*?window\.INITIAL_USER_AVATARS = <\?php[^\n]*\n/;
  if (!injected.test(html)) throw new Error('division_random.php: injection block not found');
  html = html.replace(injected, BOOTSTRAP);

  html = rewriteLinks(html);
  html = patchEndpoints(patchAvatars(makeAwaitData(html)));
  fs.writeFileSync(path.join(OUT, 'division_random.html'), html);
  return html;
}

function portAllRandom() {
  let html = fs.readFileSync(path.join(SRC, 'all_random.html'), 'utf8');
  // the .html twin expects PHP to have injected the globals -> add them ourselves
  if (!/window\.INITIAL_USER_DATA\s*=/.test(html)) {
    html = html.replace(/<body([^>]*)>/i, (m, attrs) => `<body${attrs}>\n  <script>${BOOTSTRAP}</script>`);
  }
  html = rewriteLinks(html);
  html = patchEndpoints(patchAvatars(makeAwaitData(html)));
  fs.writeFileSync(path.join(OUT, 'all_random.html'), html);
  return html;
}

// portraits resolved by name from /api/officers, ahead of the gender icon
function patchAvatars(html) {
  const target = 'const url = getAvatarUrl(key);';
  if (!html.includes(target)) {
    console.warn('  avatar resolution line not found — page left as generated');
    return html;
  }
  const replacement = `const url = getAvatarUrl(key)
        || (window.OFFICER_PHOTOS || {})['name_' + encodeURIComponent(u.name || '')]
        || (window.OFFICER_PHOTOS || {})['n_' + String(u.name || '').normalize('NFC').replace(/\\s+/g, '').replace(/^(นางสาว|นาง|นาย|ด\\.ช\\.|ด\\.ญ\\.)/, '')]
        || (u.photo ? ((u.photo.startsWith('http') || u.photo.startsWith('/')) ? u.photo : '/' + u.photo) : null);`;
  return html.replace(target, replacement);
}

// point the ported pages at the Node API instead of the PHP endpoints, and use
// the JSON upload shape /api/upload_avatar expects (the PHP one took multipart)
function patchEndpoints(html) {
  html = html.replace(/\s*const formData = new FormData\(\);[\s\S]*?fetch\('upload_avatar\.php', \{ method: 'POST', body: formData \}\)/, `
        fetch('/api/upload_avatar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: key, imageBase64: dataUrl })
        })`);
  html = html.replace(/'upload_avatar\.php'/g, "'/api/upload_avatar'");
  html = html.replace(/'save_state\.php'/g, "'/api/save_state'");
  html = html.replace(/"upload_avatar\.php"/g, '"/api/upload_avatar"');
  html = html.replace(/"save_state\.php"/g, '"/api/save_state"');
  // show every person at once instead of a horizontal scroller
  html = html.replace(
    'mt-4 flex items-center gap-3.5 overflow-x-auto pb-3 pt-1 px-1 custom-scrollbar',
    'mt-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 pb-3 pt-1 px-1'
  );
  html = html.replace(/shrink-0 w-72 sm:w-80 p-3\.5 rounded-2xl/g, 'p-3.5 rounded-2xl w-full');
  return html;
}

fs.mkdirSync(OUT, { recursive: true });
const div = portDivision();
const all = portAllRandom();

// copied after the writes so the folder is self-contained
const seminarSrc = path.join(SRC, 'seminar_users.json');
if (fs.existsSync(seminarSrc)) {
  fs.copyFileSync(seminarSrc, path.join(OUT, 'officials_seminar.json'));
  console.log('officials_seminar.json', fs.statSync(seminarSrc).size, 'bytes');
}

for (const [name, html] of [['division_random.html', div], ['all_random.html', all]]) {
  const checks = {
    bytes: html.length,
    phpLeft: (html.match(/<\?php/g) || []).length,
    phpLinks: (html.match(/\.php"/g) || []).length,
    bootstrap: /window\.DATA_LOADED/.test(html),
    awaitsData: /await window\.DATA_LOADED/.test(html),
    scripts: (html.match(/<script/g) || []).length,
  };
  console.log(name, JSON.stringify(checks));
}
