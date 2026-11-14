// fetch-photos.js — refresh missing eoffice profile photos for officials_live.json.
// Logs in once, then resolves every photo through the app's own API
// (fileAttachs/getProfilePicLast/profile/linkId/{user.id}).
//
// Usage: node scripts/fetch-photos.js [--all] [--list=officials_live.json]
const fs = require('fs');
const path = require('path');
const { login } = require('./eoffice-client.js');
const { fetchPhotos } = require('./lib-photos.js');

const ROOT = path.join(__dirname, '..');

(async () => {
  const force = process.argv.includes('--all');
  const listArg = process.argv.find((a) => a.startsWith('--list='));
  const file = listArg ? path.resolve(ROOT, listArg.split('=')[1]) : path.join(ROOT, 'officials_live.json');
  const people = JSON.parse(fs.readFileSync(file, 'utf8'));

  const { token } = await login();
  const res = await fetchPhotos(token, people, { force, log: (m) => console.log(m) });

  fs.writeFileSync(file, JSON.stringify(people, null, 2), 'utf8');
  console.log('OK photos:', res.total, '/', people.length, '| newly found:', res.found);
  const left = people.filter((p) => !p.photo);
  console.log('still without photo:', left.length, left.slice(0, 5).map((p) => `${p.id}:${p.name}`).join(' | '));
})().catch((e) => { console.error('FAILED:', e.message.split('\n')[0]); process.exit(1); });