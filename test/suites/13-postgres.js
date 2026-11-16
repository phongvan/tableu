'use strict';
// Driver PostgreSQL chay qua app that.
// Can container `tableu-pg-test` (xem test/pg-test.sh). Khong co thi tu bo qua.
const { Client } = require('pg');
const { execSync } = require('node:child_process');

const PG = {
  host: process.env.TABLEU_PG_HOST || '127.0.0.1',
  port: Number(process.env.TABLEU_PG_PORT) || 55432,
  user: process.env.TABLEU_PG_USER || 'postgres',
  password: process.env.TABLEU_PG_PASS || 'pgtest123',
  database: process.env.TABLEU_PG_DB || 'tableu_pg',
};

function coPg() {
  try {
    return execSync('docker ps --filter name=tableu-pg-test --format "{{.Names}}"',
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).includes('tableu-pg-test');
  } catch { return false; }
}

async function gieo() {
  const c = new Client(PG);
  await c.connect();
  await c.query('DROP SCHEMA IF EXISTS kho CASCADE');
  await c.query('DROP TABLE IF EXISTS nguoi_dung CASCADE');
  await c.query('DROP TABLE IF EXISTS khong_pk CASCADE');
  await c.query(`CREATE TABLE nguoi_dung (
    id serial PRIMARY KEY,
    ten varchar(100) NOT NULL,
    email varchar(190),
    diem numeric(12,2) NOT NULL DEFAULT 0,
    ghi_chu text,
    du_lieu jsonb,
    co_that boolean DEFAULT true,
    luc timestamptz DEFAULT now(),
    gap_doi numeric(14,2) GENERATED ALWAYS AS (diem * 2) STORED)`);
  await c.query(`INSERT INTO nguoi_dung (ten,email,diem,ghi_chu,du_lieu) VALUES
    ('An','an@x.com',10.5,'ghi chu','{"k":1}'),
    ('Bình',NULL,0,NULL,NULL),
    ('Cường','c@x.com',99.99,NULL,NULL)`);
  await c.query('CREATE TABLE khong_pk (x int, y text)');
  await c.query("INSERT INTO khong_pk VALUES (1,'a'),(2,'b')");
  await c.query('CREATE VIEW v_nguoi_dung AS SELECT id, ten FROM nguoi_dung');
  await c.query('CREATE SCHEMA kho');
  await c.query('CREATE TABLE kho.hang (ma int PRIMARY KEY, ten text)');
  await c.query('ANALYZE nguoi_dung');
  await c.end();
}

async function chay(ctx) {
  const { ok, run, doiToi } = ctx;
  if (!coPg()) { ok(true, 'BO QUA: khong thay container tableu-pg-test (xem test/pg-test.sh)'); return; }
  await gieo();

  /* ---------------- giao dien co chon duoc loai database ---------------- */
  const ds = await run(`window.api.db.driverList()`);
  ok(ds.ok && ds.data.some((d) => d.loai === 'postgres'), 'main process cong bo driver postgres');
  const pgInfo = ds.data.find((d) => d.loai === 'postgres');
  ok(pgInfo.nhanCapHai === 'Schema', `cap hai cua cay goi la "${pgInfo.nhanCapHai}"`);
  ok(pgInfo.congMacDinh === 5432, `cong mac dinh ${pgInfo.congMacDinh}`);
  ok(pgInfo.hoTroXuatNhap === false, 'bao ro chua ho tro xuat/nhap SQL');

  /* ---------------- kiem tra ket noi ---------------- */
  const cfgKn = { loai: 'postgres', name: 'PG test', host: PG.host, port: PG.port,
    user: PG.user, password: PG.password, database: PG.database };
  let r = await run(`window.api.conn.test(${JSON.stringify(cfgKn)})`);
  ok(r.ok && /PostgreSQL 16/.test(r.data.version), `ket noi: ${r.ok ? r.data.version.slice(0, 22) : r.error}`);
  ok(r.ok && r.data.loai === 'postgres', 'bao dung loai driver');

  r = await run(`window.api.conn.test(${JSON.stringify({ ...cfgKn, password: 'sai-bet' })})`);
  ok(!r.ok && /password|authentication/i.test(r.error), `sai mat khau bi chan: "${r.ok ? '' : r.error.slice(0, 50)}"`);

  /* ---------------- duyet cay ---------------- */
  await run(`window.api.conn.save(${JSON.stringify(cfgKn)})`);
  await run(`window.__tableu.reloadConnections().then(() => 'ok')`);
  const i = await run(`window.__tableu.state.connections.findIndex(c => c.name === 'PG test')`);
  ok(i >= 0, 'luu duoc ket noi postgres');

  await run(`window.__tableu.toggleConn(window.__tableu.state.connections[${i}]); 'ok';`);
  await doiToi(`(window.__tableu.state.nodes[window.__tableu.state.connections[${i}].id]
    .databases || []).length > 0`, 'nap duoc danh sach schema', 20000);
  const schemas = JSON.parse(await run(`JSON.stringify(window.__tableu.state.nodes[
    window.__tableu.state.connections[${i}].id].databases)`));
  ok(schemas.includes('public') && schemas.includes('kho'),
     `thay cac schema: ${JSON.stringify(schemas)}`);

  const cid = await run(`window.__tableu.state.connections[${i}].id`);
  const goi = (m, ...a) => run(`window.api.db.${m}(${['"' + cid + '"', ...a.map((x) => JSON.stringify(x))].join(',')})`);

  /* ---------------- bang, cot, chi muc, DDL ---------------- */
  let b = await goi('tables', 'public');
  ok(b.ok && b.data.some((x) => x.name === 'nguoi_dung' && x.kind === 'table'),
     `bang trong public: ${b.ok ? b.data.map((x) => x.name).join(', ') : b.error}`);
  ok(b.data.some((x) => x.name === 'v_nguoi_dung' && x.kind === 'view'), 'nhan ra view');
  const nd = b.data.find((x) => x.name === 'nguoi_dung');
  ok(nd.estRows === 3, `so dong uoc luong sau ANALYZE: ${nd.estRows}`);

  b = await goi('tables', 'kho');
  ok(b.ok && b.data.length === 1 && b.data[0].name === 'hang', 'schema khac cung duyet duoc');

  const c = await goi('columns', 'public', 'nguoi_dung');
  ok(c.ok && c.data.length === 9, `${c.ok ? c.data.length : '?'} cot`);
  const cid2 = c.data.find((x) => x.field === 'id');
  ok(cid2.key === 'PRI' && cid2.extra === 'auto_increment', 'nhan dung khoa chinh + tu tang');
  ok(c.data.find((x) => x.field === 'gap_doi').extra === 'STORED GENERATED', 'nhan dung cot sinh');

  const d = await goi('ddl', 'public', 'nguoi_dung');
  ok(d.ok && /CREATE TABLE "public"\."nguoi_dung"/.test(d.data), 'dung lai duoc DDL');
  ok(/PRIMARY KEY \("id"\)/.test(d.data), 'DDL co khoa chinh');

  /* ---------------- xem du lieu ---------------- */
  const rows = await goi('rows', 'public', 'nguoi_dung', { limit: 10, offset: 0 });
  ok(rows.ok && rows.data.total === 3, `dem dung ${rows.ok ? rows.data.total : '?'} dong`);
  ok(rows.data.meta.suaDuoc === true, 'bang co khoa chinh -> sua duoc');
  ok(JSON.stringify(rows.data.meta.pk) === '["id"]', `pk = ${JSON.stringify(rows.data.meta.pk)}`);
  const kieu = rows.data.columns.map((x) => x.kind);
  ok(kieu[0] === 'num' && kieu[1] === 'text' && kieu[5] === 'json' && kieu[6] === 'bool' && kieu[7] === 'time',
     `to mau theo kieu: ${JSON.stringify(kieu)}`);
  ok(rows.data.rows[1][2] === null, 'o NULL giu dung null');
  ok(typeof rows.data.rows[0][7] === 'string', `ngay gio la chuoi: ${JSON.stringify(rows.data.rows[0][7])}`);

  // sap xep + loc
  const sx = await goi('rows', 'public', 'nguoi_dung', { limit: 10, offset: 0, orderBy: 'diem', orderDir: 'DESC' });
  ok(sx.data.rows[0][1] === 'Cường', `sap xep giam dan: ${sx.data.rows[0][1]}`);
  const lo = await goi('rows', 'public', 'nguoi_dung', { limit: 10, offset: 0, where: 'diem > 5' });
  ok(lo.data.total === 2, `loc WHERE: ${lo.data.total} dong`);

  const kpk = await goi('rows', 'public', 'khong_pk', { limit: 10, offset: 0 });
  ok(kpk.data.meta.suaDuoc === false, `bang khong khoa chinh -> chi doc ("${kpk.data.meta.lyDo}")`);

  /* ---------------- chay truy van ---------------- */
  const q = await goi('query', 'public', 'SELECT 1 AS a, \'x\' AS b', 10);
  // cell() luon doi gia tri thanh chuoi truoc khi gui sang giao dien,
  // giong het duong MySQL — nen so voi '1' chu khong phai 1.
  ok(q.ok && q.data.kind === 'rows' && q.data.rows[0][0] === '1',
     `chay duoc truy van -> ${q.ok ? JSON.stringify({ kind: q.data.kind, rows: q.data.rows }) : q.error}`);
  const qLoi = await goi('query', 'public', 'SELEC sai', 10);
  ok(!qLoi.ok && /syntax/i.test(qLoi.error), 'loi cu phap bao dung');
  const qCat = await goi('query', 'public', 'SELECT generate_series(1,500) AS n', 10);
  ok(qCat.ok && qCat.data.rows.length === 10 && qCat.data.biCat === true,
     `cat o 10 dong, biCat=${qCat.ok ? qCat.data.biCat : '?'}`);

  /* ---------------- goi y ten bang/cot ---------------- */
  const sc = await goi('schema', 'public');
  ok(sc.ok && sc.data.nguoi_dung && sc.data.nguoi_dung.includes('email'),
     `goi y co ${sc.ok ? Object.keys(sc.data).length : '?'} bang`);

  /* ---------------- ghi: sua o, them dong, xoa dong ---------------- */
  const keys = rows.data.keys[0];
  const u = await goi('updateCell', 'public', 'nguoi_dung', keys, 'ten', 'An Đã Sửa');
  ok(u.ok && u.data.affectedRows === 1, `sua o: ${u.ok ? 'ok' : u.error}`);
  ok(u.ok && u.data.row[1] === 'An Đã Sửa', 'doc lai dong sau khi sua');

  const gen = await goi('updateCell', 'public', 'nguoi_dung', keys, 'gap_doi', '1');
  ok(!gen.ok && /sinh tự động/.test(gen.error), `chan sua cot sinh: "${gen.ok ? '' : gen.error}"`);

  const them = await goi('insertRow', 'public', 'nguoi_dung', { ten: 'Dũng', diem: '7.5' });
  ok(them.ok && them.data.affectedRows === 1, `them dong: ${them.ok ? 'ok' : them.error}`);
  ok(them.ok && Number(them.data.insertId) > 0, `RETURNING cho ra id = ${them.ok ? them.data.insertId : '?'}`);

  const sau = await goi('rows', 'public', 'nguoi_dung', { limit: 10, offset: 0 });
  ok(sau.data.total === 4, `con ${sau.data.total} dong sau khi them`);
  const dungGen = sau.data.rows.find((x) => x[1] === 'Dũng');
  ok(dungGen[8] === '15.00', `cot sinh tu tinh: ${dungGen[8]}`);

  const xoa = await goi('deleteRow', 'public', 'nguoi_dung', [them.data.insertId]);
  ok(xoa.ok && xoa.data.affectedRows === 1, 'xoa duoc dong');

  /* ---------------- xoa sach / xoa bang ---------------- */
  const tr = await goi('truncateTable', 'public', 'khong_pk');
  ok(tr.ok && tr.data.soDongDaXoa === 2, `TRUNCATE xoa ${tr.ok ? tr.data.soDongDaXoa : '?'} dong`);
  const trView = await goi('truncateTable', 'public', 'v_nguoi_dung');
  ok(!trView.ok && /View/.test(trView.error), 'TRUNCATE tren view bi chan');
  const dr = await goi('dropTable', 'public', 'khong_pk');
  ok(dr.ok, 'xoa duoc bang');
  const drBia = await goi('dropTable', 'public', 'bang_bia_dat');
  ok(!drBia.ok && /Không tìm thấy/.test(drBia.error), 'chan ten bang bia dat');

  /* ---------------- gia tri day du cua mot o ---------------- */
  const cl = new Client(PG);
  await cl.connect();
  await cl.query("UPDATE nguoi_dung SET ghi_chu = repeat('z', 9000) WHERE id = $1", [keys[0]]);
  await cl.end();
  const lai = await goi('rows', 'public', 'nguoi_dung', { limit: 10, offset: 0 });
  const iGc = lai.data.columns.findIndex((x) => x.name === 'ghi_chu');
  const dongCat = lai.data.rows.find((x) => String(x[0]) === String(keys[0]));
  ok(!!dongCat, `tim lai duoc dong id=${keys[0]} trong ${lai.data.rows.length} dong`
     + ` (cac id: ${JSON.stringify(lai.data.rows.map((x) => x[0]))})`);
  const oCat = dongCat ? dongCat[iGc] : null;
  ok(oCat && oCat.cat === true && oCat.dai === 9000,
     `luoi cat o dai: ${JSON.stringify(oCat)}`.slice(0, 110));
  const day = await goi('cellValue', 'public', 'nguoi_dung', keys, 'ghi_chu');
  ok(day.ok && day.data.giaTri.length === 9000, `tai duoc day du ${day.ok ? day.data.giaTri.length : '?'} ky tu`);
}

module.exports = { chay };
