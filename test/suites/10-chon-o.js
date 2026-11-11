'use strict';
// Chon o bang chuot/ban phim, copy vung chon, va bang chi tiet o.
const mysql = require('mysql2/promise');
const { moKetNoi, moTabDuLieu } = require('../tien-ich');

const P = `document.querySelector('.pane.active')`;
const O_CHON = `${P}.querySelector('td.o-chon')`;
const SO_VUNG = `${P}.querySelectorAll('td.trong-vung').length`;
const CT = `${P}.querySelector('.chi-tiet')`;

const phimLuoi = (k, opt = {}) => `(() => {
  const w = ${P}.querySelector('.grid-wrap');
  w.dispatchEvent(new KeyboardEvent('keydown', Object.assign(
    { key: ${JSON.stringify(k)}, bubbles: true, cancelable: true }, ${JSON.stringify(opt)})));
  return 'ok'; })()`;

async function chay(ctx) {
  const { ok, run, doiToi, cfg } = ctx;
  const db = cfg.playground;

  // mot o rat dai de thu phan cat
  const c0 = await mysql.createConnection({
    host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password, database: db });
  await c0.query('DROP TABLE IF EXISTS o_dai');
  await c0.query('CREATE TABLE o_dai (id INT AUTO_INCREMENT PRIMARY KEY, noi_dung LONGTEXT, j JSON)');
  await c0.query("INSERT INTO o_dai (noi_dung, j) VALUES (REPEAT('x', 9000), '{\"a\":1,\"b\":[2,3]}')");
  await c0.end();

  await moKetNoi(ctx, db);
  await moTabDuLieu(ctx, db, 'nguoi_dung');

  /* ---------------- chon bang chuot ---------------- */
  ok(await run(`!${O_CHON}`), 'ban dau chua chon o nao');
  await run(`(() => { const td = ${P}.querySelector('tbody tr[data-r="1"] td[data-c="1"]');
    td.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })); })(); 'ok';`);
  await doiToi(O_CHON, 'bam chuot chon duoc o');
  let vt = JSON.parse(await run(`JSON.stringify({ r: window.__tableu.chon.r, c: window.__tableu.chon.c })`));
  ok(vt.r === 1 && vt.c === 1, `o dang chon: dong ${vt.r}, cot ${vt.c}`);
  ok(await run(SO_VUNG) === 1, 'vung chon dung mot o');

  /* ---------------- ban phim ---------------- */
  await run(phimLuoi('ArrowDown'));
  await run(phimLuoi('ArrowRight'));
  vt = JSON.parse(await run(`JSON.stringify({ r: window.__tableu.chon.r, c: window.__tableu.chon.c })`));
  ok(vt.r === 2 && vt.c === 2, `mui ten di chuyen: dong ${vt.r}, cot ${vt.c}`);

  await run(phimLuoi('Home'));
  ok(await run(`window.__tableu.chon.c`) === 0, 'Home ve cot dau');
  await run(phimLuoi('End'));
  const nc = await run(`${P}.querySelectorAll('thead th').length - 1`);
  ok(await run(`window.__tableu.chon.c`) === nc - 1, `End toi cot cuoi (${nc} cot)`);
  await run(phimLuoi('Home', { ctrlKey: true }));
  vt = JSON.parse(await run(`JSON.stringify({ r: window.__tableu.chon.r, c: window.__tableu.chon.c })`));
  ok(vt.r === 0 && vt.c === 0, 'Ctrl+Home ve o dau tien');

  // khong ra ngoai bien
  await run(phimLuoi('ArrowUp'));
  await run(phimLuoi('ArrowLeft'));
  vt = JSON.parse(await run(`JSON.stringify({ r: window.__tableu.chon.r, c: window.__tableu.chon.c })`));
  ok(vt.r === 0 && vt.c === 0, 'khong di ra ngoai bien luoi');

  /* ---------------- mo rong vung bang Shift ---------------- */
  await run(phimLuoi('ArrowDown', { shiftKey: true }));
  await run(phimLuoi('ArrowRight', { shiftKey: true }));
  ok(await run(SO_VUNG) === 4, `Shift+mui ten mo rong vung: ${await run(SO_VUNG)} o`);

  /* ---------------- Ctrl+A ---------------- */
  await run(phimLuoi('a', { ctrlKey: true }));
  const nd = await run(`${P}.querySelectorAll('tbody tr').length`);
  ok(await run(SO_VUNG) === nd * nc, `Ctrl+A chon het ${nd}x${nc} = ${nd * nc} o`);

  /* ---------------- copy thanh TSV ---------------- */
  await run(`(() => { const t = window.__tableu.chon;
    t.r = 0; t.c = 0; t.rNeo = 1; t.cNeo = 1; })(); 'ok';`);
  await run(`window.__tableu.datO(${P}.querySelector('.grid-wrap'), 0, 0, false); 'ok';`);
  await run(`(() => { const t = window.__tableu.chon; t.rNeo = 1; t.cNeo = 1; })(); 'ok';`);
  let tsv = await run(`window.__tableu.chonThanhTsv(false)`);
  let dong = tsv.split('\n');
  ok(dong.length === 2, `TSV co ${dong.length} dong`);
  ok(dong[0].split('\t').length === 2, `moi dong co ${dong[0].split('\t').length} cot, ngan cach bang tab`);

  tsv = await run(`window.__tableu.chonThanhTsv(true)`);
  dong = tsv.split('\n');
  ok(dong.length === 3 && /id\tten/.test(dong[0]), `kem tieu de: dong dau la "${dong[0]}"`);

  // bam cot # chon ca dong
  await run(`(() => { const td = ${P}.querySelector('tbody tr[data-r="0"] td.rownum');
    td.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })); })(); 'ok';`);
  await ctx.sleep(200);
  ok(await run(SO_VUNG) === nc, `bam cot # chon ca dong (${nc} o)`);

  /* ---------------- bang chi tiet ---------------- */
  ok(await run(`${CT}.hidden`), 'bang chi tiet an luc dau');
  await run(`${P}.querySelector('.pane-toolbar .btn[title*="chi tiết"]').click(); 'ok';`);
  await doiToi(`!${CT}.hidden`, 'nut mo bang chi tiet');

  await run(`window.__tableu.datO(${P}.querySelector('.grid-wrap'), 0, 1, false); 'ok';`);
  await doiToi(`${P}.querySelector('.ct-than').textContent.length > 0`, 'chi tiet hien gia tri');
  let ct = JSON.parse(await run(`JSON.stringify({
    nhan: ${P}.querySelector('.ct-nhan').textContent,
    than: ${P}.querySelector('.ct-than').textContent })`));
  ok(/^ten · dòng 1$/.test(ct.nhan), `chi tiet ghi dung cot va dong: "${ct.nhan}"`);
  ok(ct.than === 'An', `hien dung gia tri: "${ct.than}"`);

  // o NULL
  await run(`window.__tableu.datO(${P}.querySelector('.grid-wrap'), 1, 2, false); 'ok';`);
  await doiToi(`${P}.querySelector('.ct-than').textContent === 'NULL'`, 'o NULL hien NULL');
  ok(true, 'o NULL hien dung chu NULL');

  /* ---------------- o dai 9000 ky tu: phai tai day du ---------------- */
  await moTabDuLieu(ctx, db, 'o_dai');
  await run(`${P}.querySelector('.pane-toolbar .btn[title*="chi tiết"]').click(); 'ok';`);
  await doiToi(`!${CT}.hidden`, 'mo chi tiet o tab moi');

  const iNd = await run(`window.__tableu.state.tabs.slice(-1)[0]
    .result.columns.findIndex(c => c.name === 'noi_dung')`);
  const oLuoi = await run(`(() => { const v = window.__tableu.state.tabs.slice(-1)[0]
    .result.rows[0][${iNd}];
    return JSON.stringify({ kieu: typeof v, cat: !!(v && v.cat), dai: v && v.dai,
      daiTrongLuoi: v && v.text ? v.text.length : -1 }); })()`);
  const ol = JSON.parse(oLuoi);
  ok(ol.cat === true && ol.dai === 9000 && ol.daiTrongLuoi === 4096,
     `luoi chi giu ${ol.daiTrongLuoi} ky tu, bao that su dai ${ol.dai}`);
  ok(await run(`${P}.querySelector('tbody td.bi-cat') !== null`), 'o bi cat co danh dau tren luoi');

  await run(`window.__tableu.datO(${P}.querySelector('.grid-wrap'), 0, ${iNd}, false); 'ok';`);
  await doiToi(`${P}.querySelector('.ct-than').textContent.length === 9000`,
               'tai duoc day du 9000 ky tu tu DB');
  ok(true, 'bang chi tiet tai day du gia tri bi cat');

  /* ---------------- JSON dinh dang lai ---------------- */
  const iJ = await run(`window.__tableu.state.tabs.slice(-1)[0]
    .result.columns.findIndex(c => c.name === 'j')`);
  await run(`window.__tableu.datO(${P}.querySelector('.grid-wrap'), 0, ${iJ}, false); 'ok';`);
  await doiToi(`${P}.querySelector('.ct-than').textContent.includes('"a"')`, 'hien gia tri json');
  const mot = await run(`${P}.querySelector('.ct-than').textContent.split('\\n').length`);
  await run(`[...${P}.querySelectorAll('.ct-nut')].find(b => b.textContent === 'JSON').click(); 'ok';`);
  await ctx.sleep(300);
  const nhieu = await run(`${P}.querySelector('.ct-than').textContent.split('\\n').length`);
  ok(nhieu > mot, `nut JSON xuong dong cho de doc: ${mot} -> ${nhieu} dong`);

  const c9 = await mysql.createConnection({
    host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password, database: db });
  await c9.query('DROP TABLE IF EXISTS o_dai');
  await c9.end();
}

module.exports = { chay };
