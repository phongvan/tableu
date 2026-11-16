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
const { hienThi } = require('../lib/version');
const fs = require('node:fs');
const path = require('node:path');

const GOC = path.join(__dirname, '..');
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const TANG = new Set(['patch', 'minor', 'major']);
// Cho viet tat: "1.5" la y 1.5.0, "2" la y 2.0.0. package.json bat buoc du
// ba so nen phai bu vao, nhung van in ra de nguoi dung thay minh duoc hieu
// thanh version nao.
const VIET_TAT = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(-[0-9A-Za-z.-]+)?$/;

function buDuBaSo(v) {
  if (TANG.has(v)) return v;
  const m = VIET_TAT.exec(v);
  if (!m) return v;          // de phan kiem tra ben duoi bao loi
  return `${m[1]}.${m[2] || 0}.${m[3] || 0}${m[4] || ''}`;
}

function doc() {
  return JSON.parse(fs.readFileSync(path.join(GOC, 'package.json'), 'utf8'));
}

function chay(lenh, thamSo, moTa, themEnv = {}) {
  const r = spawnSync(lenh, thamSo, {
    cwd: GOC,
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '', ...themEnv },
  });
  if (r.status !== 0) {
    console.error(`\nHỏng ở bước: ${moTa}`);
    process.exit(r.status || 1);
  }
}

function datVersion(dauVao) {
  const truoc = doc().version;
  const v = buDuBaSo(dauVao);
  if (!TANG.has(v) && !SEMVER.test(v)) {
    console.error(`Version không hợp lệ: "${dauVao}"`);
    console.error('Dùng dạng 1.2.3 (viết tắt 1.5 hay 2 cũng được),');
    console.error('hoặc patch / minor / major.');
    process.exit(2);
  }
  if (v !== dauVao) console.log(`Hiểu "${dauVao}" thành ${v}`);
  // Giao cho npm lo, no cap nhat ca package-lock.json.
  chay('npm', ['version', v, '--no-git-tag-version', '--allow-same-version'], 'đặt version');
  const sau = doc().version;
  console.log(`Version: ${truoc} -> ${sau}\n`);
  return sau;
}

function main() {
  const [dich, version] = process.argv.slice(2);
  if (dich !== 'deb') {
    console.error('Cách dùng: node scripts/dong-goi.js deb [version]');
    process.exit(2);
  }
  if (version) datVersion(version);

  const v = hienThi(doc().version);
  console.log(`Đóng gói TableU ${v} (${dich})\n`);

  const raDeb = path.join(GOC, 'dist', `tableu_${v}_amd64.deb`);
  if (fs.existsSync(raDeb)) console.log(`Lưu ý: sẽ ghi đè ${path.basename(raDeb)}\n`);

  chay('npx', ['electron-builder', '--linux', 'dir'], 'giải nén bản build');
  chay('bash', ['scripts/build-deb.sh'], 'đóng gói .deb', { TABLEU_IM_LANG: '1' });

  if (fs.existsSync(raDeb)) {
    const mb = (fs.statSync(raDeb).size / 1048576).toFixed(0);
    console.log(`\nXong:\n  ${path.relative(GOC, raDeb)}  (${mb} MB)`);
  }
  huongDanCai(raDeb, v);
}

// Phien ban tableu dang cai tren may, de biet lan nay la nang cap hay cai moi.
function banDangCai() {
  try {
    const r = spawnSync('dpkg-query', ['-W', '-f=${Version}', 'tableu'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return r.status === 0 && r.stdout.trim() ? r.stdout.trim() : null;
  } catch { return null; }
}

function huongDanCai(raDeb, v) {
  if (!fs.existsSync(raDeb)) return;
  const duong = path.relative(GOC, raDeb);

  console.log('\nCài đặt:');
  console.log(`  cd ${GOC}`);
  console.log(`  sudo apt install ./${duong}`);
  // Thieu "./" thi apt hieu la ten goi tren repo va bao
  // "Unable to locate package" — nguoi dung da vap dung cho nay.
  console.log('\n  Dấu ./ là bắt buộc. Thiếu nó apt tưởng đây là tên gói');
  console.log('  trên repo và báo "Unable to locate package".');

  const cu = banDangCai();
  if (cu === v) console.log(`\n  Máy đang cài đúng ${v} — cài lại sẽ ghi đè bản cũ.`);
  else if (cu) console.log(`\n  Máy đang cài ${cu}, lệnh trên nâng lên ${v} (không cần gỡ trước).`);
  else console.log('\n  Máy chưa cài TableU bao giờ.');
  console.log('  Gỡ:  sudo apt remove tableu');
}

main();
