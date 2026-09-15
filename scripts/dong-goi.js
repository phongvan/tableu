'use strict';
// Dieu phoi viec dong goi. Nhan version lam tham so:
//
//   npm run dist:deb                 -> dung version hien tai trong package.json
//   npm run dist:deb -- 0.2.0        -> dat version 0.2.0 roi build
//   npm run dist:deb -- patch        -> tang so cuoi (0.1.0 -> 0.1.1) roi build
//
// Version duoc ghi vao package.json TRUOC khi build, khong chi doi ten tep.
// Neu chi doi ten tep thi ban trong goi van bao version cu: muc Version cua
// DEBIAN/control, va hop thoai Gioi thieu trong app deu doc tu package.json.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const GOC = path.join(__dirname, '..');
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const TANG = new Set(['patch', 'minor', 'major']);

function doc() {
  return JSON.parse(fs.readFileSync(path.join(GOC, 'package.json'), 'utf8'));
}

function chay(lenh, thamSo, moTa) {
  const r = spawnSync(lenh, thamSo, {
    cwd: GOC,
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '' },
  });
  if (r.status !== 0) {
    console.error(`\nHỏng ở bước: ${moTa}`);
    process.exit(r.status || 1);
  }
}

function datVersion(v) {
  const truoc = doc().version;
  if (!TANG.has(v) && !SEMVER.test(v)) {
    console.error(`Version không hợp lệ: "${v}"`);
    console.error('Dùng dạng 1.2.3, hoặc patch / minor / major.');
    process.exit(2);
  }
  // Giao cho npm lo, no cap nhat ca package-lock.json.
  chay('npm', ['version', v, '--no-git-tag-version', '--allow-same-version'], 'đặt version');
  const sau = doc().version;
  console.log(`Version: ${truoc} -> ${sau}\n`);
  return sau;
}

function main() {
  const [dich, version] = process.argv.slice(2);
  if (!['deb', 'appimage', 'all'].includes(dich)) {
    console.error('Cách dùng: node scripts/dong-goi.js <deb|appimage|all> [version]');
    process.exit(2);
  }
  if (version) datVersion(version);

  const v = doc().version;
  console.log(`Đóng gói TableU ${v} (${dich})\n`);

  const raDeb = path.join(GOC, 'dist', `tableu_${v}_amd64.deb`);
  const raApp = path.join(GOC, 'dist', `TableU-${v}-x86_64.AppImage`);
  for (const f of [raDeb, raApp]) {
    if (fs.existsSync(f)) console.log(`Lưu ý: sẽ ghi đè ${path.basename(f)}\n`);
  }

  if (dich === 'appimage' || dich === 'all') {
    chay('npx', ['electron-builder', '--linux', 'AppImage'], 'build AppImage');
  }
  if (dich === 'deb' || dich === 'all') {
    chay('npx', ['electron-builder', '--linux', 'dir'], 'giải nén bản build');
    chay('bash', ['scripts/build-deb.sh'], 'đóng gói .deb');
  }

  console.log('\nXong:');
  for (const f of [raDeb, raApp]) {
    if (!fs.existsSync(f)) continue;
    const mb = (fs.statSync(f).size / 1048576).toFixed(0);
    console.log(`  ${path.relative(GOC, f)}  (${mb} MB)`);
  }
}

main();
