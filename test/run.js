'use strict';
// Chay lan luot tung suite trong mot tien trinh Electron rieng, roi tong ket.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { seed } = require('./seed');
const cfg = require('./config');

const GOC = path.join(__dirname, '..');
const ELECTRON = path.join(GOC, 'node_modules', '.bin', 'electron');

// Loc bot tieng on cua GPU/Wayland, giu lai moi thu khac
const ON = /GetVSyncParametersIfAvailable|gl_surface_presentation|command_buffer_proxy|GPU state invalid/;

async function main() {
  if (!fs.existsSync(ELECTRON)) {
    console.error('Chua co Electron — chay `npm install` truoc.');
    process.exit(2);
  }
  console.log(`MySQL test: ${cfg.user}@${cfg.host}:${cfg.port}  (nhap: ${cfg.playground})`);
  try {
    await seed();
    console.log(`Da dung lai database nhap "${cfg.playground}".`);
  } catch (e) {
    console.error(`\nKhong ket noi duoc MySQL: ${e.message}`);
    console.error('Dat lai bang TABLEU_TEST_HOST / _PORT / _USER / _PASS neu can.');
    process.exit(2);
  }

  const loc = process.argv[2];
  const thuMuc = path.join(__dirname, 'suites');
  const suites = fs.readdirSync(thuMuc).filter((f) => f.endsWith('.js')).sort()
    .filter((f) => !loc || f.includes(loc));
  if (!suites.length) { console.error('Khong co suite nao khop.'); process.exit(2); }

  let hong = 0;
  for (const s of suites) {
    const r = spawnSync(ELECTRON, [path.join(__dirname, 'harness.js'), path.join(thuMuc, s)], {
      cwd: GOC,
      encoding: 'utf8',
      // ELECTRON_RUN_AS_NODE bi ke thua khi chay tu terminal nam trong Electron
      // (VS Code, Claude Code) va se lam `require('electron')` tra ve chuoi.
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '', ELECTRON_NO_ATTACH_CONSOLE: '' },
      timeout: 5 * 60 * 1000,
    });
    const ra = `${r.stdout || ''}${r.stderr || ''}`;
    console.log(ra.split('\n').filter((l) => l.trim() && !ON.test(l)).join('\n'));
    if (r.status !== 0) hong++;
  }

  console.log(`\n${suites.length - hong}/${suites.length} suite dat.`);
  process.exit(hong ? 1 : 0);
}

main();
