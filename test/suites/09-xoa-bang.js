'use strict';
// Xoa bang / lam rong bang, va viec lam moi so dong o cay ben trai.
const mysql = require('mysql2/promise');
const { moKetNoi, moTabDuLieu } = require('../tien-ich');

async function chay(ctx) {
  const { ok, run, doiToi, cfg } = ctx;
  const db = cfg.playground;
  const noi = () => mysql.createConnection({
    host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password, database: db,
  });
  const goi = (m, ...a) => run(`window.api.db.${m}(window.__tableu.state.connections[0].id,
    ${JSON.stringify(db)}, ${a.map((x) => JSON.stringify(x)).join(',')})`);

  await moKetNoi(ctx, db);
  await run(`window.__tableu.toggleDb(window.__tableu.state.connections[0], ${JSON.stringify(db)}); 'ok';`);
  await doiToi(`(window.__tableu.state.nodes[window.__tableu.state.connections[0].id]
    .dbs[${JSON.stringify(db)}].tables || []).length > 0`, 'cay nap xong danh sach bang');

  /* ---------- lam moi phai thay so dong MOI ---------- */
  // MySQL 8 cache thong ke bang trong data dictionary 86400 giay; neu khong
  // tat thi them bao nhieu dong cay cung bao so cu.
  let c = await noi();
  await c.query('DROP TABLE IF EXISTS dem_thu');
  await c.query('CREATE TABLE dem_thu (id INT AUTO_INCREMENT PRIMARY KEY, x VARCHAR(10)) ENGINE=InnoDB');
  await c.query("INSERT INTO dem_thu (x) VALUES ('a'),('b'),('c')");
  await c.end();

  const lamMoi = `(async () => { const s = window.__tableu.state, c = s.connections[0];
    const r = await window.api.db.tables(c.id, ${JSON.stringify(db)});
    if (!r.ok) return -2;
    s.nodes[c.id].dbs[${JSON.stringify(db)}].tables = r.data;
    window.__tableu.renderTree();
    const t = r.data.find(x => x.name === 'dem_thu');
    return t ? t.estRows : -1; })()`;
  let n = await run(lamMoi);
  ok(n === 3, `bang moi tao: cay bao ${n} dong`);

  // them 21 dong nua roi lam moi — day la luc bug cu lo ra
  c = await noi();
  for (let i = 0; i < 3; i++) await c.query('INSERT INTO dem_thu (x) SELECT x FROM dem_thu');
  const [that] = await c.query('SELECT COUNT(*) n FROM dem_thu');
  await c.end();
  n = await run(lamMoi);
  ok(n === Number(that[0].n),
     `sau khi them, "Lam moi" bao ${n} dong, COUNT(*) that su la ${that[0].n}`);

  /* ---------- TRUNCATE ---------- */
  await moTabDuLieu(ctx, db, 'nguoi_dung');
  let r = await goi('truncateTable', 'nguoi_dung');
  ok(r.ok && r.data.soDongDaXoa === 3, `TRUNCATE bao xoa ${r.ok ? r.data.soDongDaXoa : r.error} dong`);
  c = await noi();
  const [sau] = await c.query('SELECT COUNT(*) n FROM nguoi_dung');
  const [cot] = await c.query(
    `SELECT COUNT(*) n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA='${db}' AND TABLE_NAME='nguoi_dung'`);
  await c.end();
  ok(Number(sau[0].n) === 0, 'bang rong sau TRUNCATE');
  ok(Number(cot[0].n) === 8, `cau truc giu nguyen (${cot[0].n} cot)`);

  r = await goi('truncateTable', 'v_nguoi_dung');
  ok(!r.ok && /View/.test(r.error), `TRUNCATE tren view bi chan: "${r.ok ? '' : r.error}"`);

  /* ---------- DROP ---------- */
  await moTabDuLieu(ctx, db, 'dem_thu');
  const soTabTruoc = await run(`window.__tableu.state.tabs.length`);
  ok(soTabTruoc > 0, `dang mo ${soTabTruoc} tab, trong do co tab dem_thu`);

  await run(`window.__tableu.xoaBang(window.__tableu.state.connections[0],
    ${JSON.stringify(db)}, 'dem_thu', 24); 'da goi';`);
  await doiToi(`document.querySelector('#xacnhan-dialog').open`, 'hien hop xac nhan');
  const hop = JSON.parse(await run(`JSON.stringify({
    tieuDe: document.querySelector('#xn-title').textContent,
    nhan: [...document.querySelectorAll('#xn-list dt')].map(x => x.textContent),
    nutOk: document.querySelector('#xn-ok').textContent })`));
  ok(/Xóa bảng dem_thu/.test(hop.tieuDe), `hop hoi dung bang: "${hop.tieuDe}"`);
  ok(hop.nhan.includes('Số dòng (ước lượng)'), `co bao so dong sap mat: ${hop.nhan.join(', ')}`);
  ok(hop.nutOk === 'Xóa bảng', `nut xac nhan ghi ro viec: "${hop.nutOk}"`);

  await run(`document.querySelector('#xn-ok').click(); 'ok';`);
  await doiToi(`!document.querySelector('#xacnhan-dialog').open`, 'hop dong lai');
  await doiToi(`!window.__tableu.state.tabs.some(t => t.table === 'dem_thu')`,
               'tab cua bang vua xoa tu dong lai');
  ok(true, 'xoa bang xong thi dong luon tab cua no');

  c = await noi();
  const [con] = await c.query(
    `SELECT COUNT(*) n FROM information_schema.TABLES
      WHERE TABLE_SCHEMA='${db}' AND TABLE_NAME='dem_thu'`);
  await c.end();
  ok(Number(con[0].n) === 0, 'bang da bi xoa khoi database');
  await doiToi(`!(window.__tableu.state.nodes[window.__tableu.state.connections[0].id]
    .dbs[${JSON.stringify(db)}].tables || []).some(x => x.name === 'dem_thu')`,
    'cay tu nap lai, khong con bang do');
  ok(true, 'cay ben trai cap nhat ngay sau khi xoa');

  /* ---------- bam Huy thi khong xoa gi ---------- */
  await run(`window.__tableu.xoaBang(window.__tableu.state.connections[0],
    ${JSON.stringify(db)}, 'khoa_ghep', 2); 'da goi';`);
  await doiToi(`document.querySelector('#xacnhan-dialog').open`, 'hien hop xac nhan lan hai');
  await run(`document.querySelector('#xn-huy').click(); 'ok';`);
  await doiToi(`!document.querySelector('#xacnhan-dialog').open`, 'hop dong khi bam Huy');
  await ctx.sleep(500);
  c = await noi();
  const [vanCon] = await c.query(
    `SELECT COUNT(*) n FROM information_schema.TABLES
      WHERE TABLE_SCHEMA='${db}' AND TABLE_NAME='khoa_ghep'`);
  await c.end();
  ok(Number(vanCon[0].n) === 1, 'bam Huy thi bang van con nguyen');

  /* ---------- ten bang bia dat bi chan ---------- */
  r = await goi('dropTable', 'bang_khong_he_ton_tai');
  ok(!r.ok && /Không tìm thấy/.test(r.error), `chan ten bang khong co that: "${r.ok ? '' : r.error}"`);
}

module.exports = { chay };
