'use strict';
// Entry point cua Electron khi chay test. `node test/run.js` goi:
//   electron test/harness.js <duong-dan-suite>
// Harness mo cua so that, nap main.js that, roi trao cho suite mot bo tien ich
// de lai renderer.
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const os = require('node:os');
const cfg = require('./config');

const suitePath = process.argv[process.argv.length - 1];

// userData rieng: khong bao gio dung vao cau hinh that cua nguoi dung
app.setPath('userData', path.join(os.tmpdir(), `tableu-test-${process.pid}`));
require(path.join(__dirname, '..', 'main.js'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  await sleep(1200);
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) { console.log('KHONG MO DUOC CUA SO'); app.exit(2); return; }
  const wc = win.webContents;

  const loiConsole = [];
  // Loi cu phap trong renderer giet ca app.js ma main process khong bao gi —
  // luon phai theo doi kenh nay, neu khong se tuong app chay tot.
  wc.on('console-message', (_e, level, msg) => {
    if (level >= 2) loiConsole.push(msg.slice(0, 300));
  });
  let renderChet = null;
  wc.on('render-process-gone', (_e, d) => { renderChet = d; });
  wc.on('unresponsive', () => { loiConsole.push('CUA SO TREO (unresponsive)'); });

  const run = (js) => wc.executeJavaScript(js, true);
  await run(`window.addEventListener('error', e =>
      console.error('WINDOW ERROR: ' + e.message));
    window.addEventListener('unhandledrejection', e =>
      console.error('REJECTION: ' + (e.reason && e.reason.stack || e.reason)));`);

  let pass = 0;
  const thatBai = [];
  const ok = (dieuKien, moTa) => {
    if (dieuKien) { pass++; console.log(`  ✓ ${moTa}`); }
    else { thatBai.push(moTa); console.log(`  ✗ ${moTa}`); }
    return !!dieuKien;
  };

  // Cho toi khi dieu kien dung, thay vi sleep mot moc co dinh.
  // Cac hieu ung co animation (vi du .tabbar co scroll-behavior:smooth) lam
  // sleep co dinh rat de nhap nhay.
  const doiToi = async (bieuThuc, moTa, hanMs = 8000) => {
    const het = Date.now() + hanMs;
    let cuoi;
    while (Date.now() < het) {
      cuoi = await run(`(() => { try { return (${bieuThuc}); } catch (e) { return false; } })()`);
      if (cuoi) return cuoi;
      await sleep(120);
    }
    throw new Error(`Qua han ${hanMs}ms khi chờ: ${moTa || bieuThuc}`);
  };

  const ctx = { win, wc, run, ok, doiToi, sleep, cfg, loiConsole };

  const ten = path.basename(suitePath);
  console.log(`\n=== ${ten} ===`);
  let loiSuite = null;
  try {
    await require(suitePath).chay(ctx);
  } catch (e) {
    loiSuite = e;
    console.log(`  ✗ SUITE NEM LOI: ${e.stack || e.message}`);
  }

  if (renderChet) {
    console.log(`  ✗ RENDERER CHET: ${JSON.stringify(renderChet)}`);
    thatBai.push('renderer chet');
  }
  if (loiConsole.length) {
    console.log(`  ✗ ${loiConsole.length} loi trong console renderer:`);
    for (const l of loiConsole.slice(0, 5)) console.log(`      ${l}`);
    thatBai.push(`${loiConsole.length} loi console`);
  }
  const hong = thatBai.length + (loiSuite ? 1 : 0);
  console.log(`  --- ${pass} dat, ${hong} hong`);
  app.exit(hong ? 1 : 0);
});
