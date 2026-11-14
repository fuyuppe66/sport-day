// lib-photos.js — shared eoffice profile-photo downloader.
//
// Chain: userProfiles/all -> officer id => user.id, then
// fileAttachs/getProfilePicLast/profile/linkId/{user.id} -> signed document url.
const fs = require('fs');
const path = require('path');
const { apiGet, BASE } = require('./eoffice-client.js');

const ROOT = path.join(__dirname, '..');
const PHOTO_DIR = path.join(ROOT, 'uploads', 'photos');

async function mapUserIds(token) {
  const r = await apiGet(token, '/mof_api/v1/userProfiles/all');
  const list = (r.body && r.body.data) || [];
  const map = new Map();
  for (const p of list) {
    const uid = p.user && p.user.id;
    if (p.id && uid) map.set(p.id, uid);
  }
  return map;
}

async function photoUrlFor(token, userId) {
  const r = await apiGet(token, `/mof_api/v1/fileAttachs/getProfilePicLast/profile/linkId/${userId}`);
  const arr = (r.body && r.body.data) || [];
  const hit = Array.isArray(arr) ? arr[0] : null;
  return hit && hit.url ? hit.url : null;
}

// people: array of roster records (need .id), mutated in place with .photo
async function fetchPhotos(token, people, opts = {}) {
  const { force = false, concurrency = 6, log = () => {} } = opts;
  fs.mkdirSync(PHOTO_DIR, { recursive: true });

  const idMap = await mapUserIds(token);
  log('profiles with user id: ' + idMap.size);

  const todo = people.filter((p) => p.id && (force || !p.photo));
  log('photo candidates: ' + todo.length + ' of ' + people.length);

  let found = 0, missing = 0, done = 0;
  const queue = [...todo];
  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length) {
      const p = queue.shift();
      const uid = idMap.get(p.id) || p.id;
      try {
        const url = await photoUrlFor(token, uid);
        if (!url) { missing++; }
        else {
          const abs = url.startsWith('http') ? url : BASE + url;
          const res = await fetch(abs, { signal: AbortSignal.timeout(25000) });
          const buf = res.ok ? Buffer.from(await res.arrayBuffer()) : Buffer.alloc(0);
          if (buf.length > 500) {
            const ext = (url.match(/\.(jpe?g|png|gif)$/i) || [, 'jpg'])[1].toLowerCase().replace('jpeg', 'jpg');
            const name = `${p.id}.${ext}`;
            fs.writeFileSync(path.join(PHOTO_DIR, name), buf);
            p.photo = `uploads/photos/${name}`;
            found++;
          } else missing++;
        }
      } catch (e) { missing++; }
      done++;
      if (done % 50 === 0) log(`  ... ${done} checked | ${found} found | ${missing} none`);
    }
  });
  await Promise.all(workers);
  return { found, missing, total: people.filter((p) => p.photo).length };
}

module.exports = { fetchPhotos, mapUserIds, photoUrlFor, PHOTO_DIR };