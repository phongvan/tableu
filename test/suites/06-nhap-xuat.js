'use strict';
// Xuat / nhap SQL. Moi phep ghi chi tren DB nhap.
//
// Handler that su mo hop thoai chon tep. Suite chay trong main process nen
// thay thang phuong thuc cua `dialog` — khong can them kenh IPC chi de test.
const { dialog } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const mysql = require('mysql2/promise');
const { moKetNoi } = require('../tien-ich');

const TAM = fs.mkdtempSync(path.join(os.tmpdir(), 'tableu-sql-'));

function datTepLuu(p) { dialog.showSaveDialog = async () => ({ canceled: false, filePath: p }); }
function datTepMo(p) { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }
function huyHopThoai() {
  dialog.showSaveDialog = async () => ({ canceled: true });
  dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
}

async function chay(ctx) {
  const { ok, run, cfg } = ctx;
  const db = cfg.playground;
  const noi = () => mysql.createConnection({
    host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password, multipleStatements: true,
  });

  await moKetNoi(ctx, db);
  const cid = await run(`window.__tableu.state.connections[0].id`);
  // Chon tep va lam viec gio la hai kenh rieng; test dua thang duong dan vao.
  let tepHienTai = null;
  const xuat = (bang, opts) => run(`window.api.sql.xuat("${cid}", ${JSON.stringify(db)},
    ${bang ? JSON.stringify(bang) : 'null'}, ${JSON.stringify(opts || {})},
    ${JSON.stringify(tepHienTai)})`);
  const nhap = (opts) => run(`window.api.sql.nhap("${cid}", ${JSON.stringify(db)},
    ${JSON.stringify(opts || {})}, ${JSON.stringify(tepHienTai)})`);

  /* ---------------- xuat mot bang ---------------- */
  const fBang = path.join(TAM, 'nguoi_dung.sql');
  datTepLuu(fBang); tepHienTai = fBang;
  let r = await xuat('nguoi_dung');
  ok(r.ok, `xuat bang: ${r.ok ? 'ok' : r.error}`);
  ok(r.data.soBang === 1 && r.data.soDong === 3, `1 bang, ${r.data.soDong} dong`);

  const sql = fs.readFileSync(fBang, 'utf8');
  ok(/DROP TABLE IF EXISTS `nguoi_dung`/.test(sql), 'co DROP TABLE IF EXISTS');
  ok(/CREATE TABLE `nguoi_dung`/.test(sql), 'co CREATE TABLE');
  ok(/INSERT INTO `nguoi_dung` VALUES /.test(sql), 'co INSERT');
  ok(/SET FOREIGN_KEY_CHECKS=0/.test(sql) && /SET FOREIGN_KEY_CHECKS=1/.test(sql),
     'co tat/bat lai FOREIGN_KEY_CHECKS');
  ok(/,NULL,/.test(sql) || /\(NULL/.test(sql) || /NULL\)/.test(sql), 'NULL xuat ra la NULL, khong phai chuoi rong');
  ok(!/'10\.50'/.test(sql) && /10\.50/.test(sql), 'cot DECIMAL xuat khong bao ngoac');

  /* ---------------- tuy chon chi cau truc / chi du lieu ---------------- */
  const fCt = path.join(TAM, 'chi-cau-truc.sql');
  datTepLuu(fCt); tepHienTai = fCt;
  await xuat('nguoi_dung', { cauTruc: true, duLieu: false });
  const sCt = fs.readFileSync(fCt, 'utf8');
  ok(/CREATE TABLE/.test(sCt) && !/INSERT INTO/.test(sCt), 'chi cau truc: co CREATE, khong INSERT');

  const fDl = path.join(TAM, 'chi-du-lieu.sql');
  datTepLuu(fDl); tepHienTai = fDl;
  await xuat('nguoi_dung', { cauTruc: false, duLieu: true });
  const sDl = fs.readFileSync(fDl, 'utf8');
  ok(!/CREATE TABLE/.test(sDl) && /INSERT INTO/.test(sDl), 'chi du lieu: co INSERT, khong CREATE');

  /* ---------------- xuat ca database ---------------- */
  const fDb = path.join(TAM, 'ca-database.sql');
  datTepLuu(fDb); tepHienTai = fDb;
  r = await xuat(null);
  ok(r.ok && r.data.soBang === 4 && r.data.soView === 1,
     `ca database: ${r.data.soBang} bang + ${r.data.soView} view`);
  const sDb = fs.readFileSync(fDb, 'utf8');
  for (const t of ['nguoi_dung', 'co_cot_sinh', 'khoa_ghep', 'khong_co_pk']) {
    ok(sDb.includes(`CREATE TABLE \`${t}\``), `dump co bang ${t}`);
  }
  ok(/CREATE .*VIEW `v_nguoi_dung`/.test(sDb) || /CREATE ALGORITHM.*`v_nguoi_dung`/.test(sDb),
     'dump co view v_nguoi_dung');
  ok(!/INSERT INTO `v_nguoi_dung`/.test(sDb), 'view KHONG bi xuat du lieu');

  /* ---------------- vong tron: xoa het roi nhap lai ---------------- */
  let c = await noi();
  const [truoc] = await c.query(`SELECT COUNT(*) n FROM \`${db}\`.nguoi_dung`);
  await c.query(`DROP DATABASE \`${db}\`; CREATE DATABASE \`${db}\`;`);
  const [trong] = await c.query(
    `SELECT COUNT(*) n FROM information_schema.TABLES WHERE TABLE_SCHEMA='${db}'`);
  ok(Number(trong[0].n) === 0, 'da xoa sach database truoc khi nhap lai');
  await c.end();

  datTepMo(fDb); tepHienTai = fDb;
  r = await nhap();
  ok(r.ok, `nhap: ${r.ok ? r.data.soCau + ' cau lenh' : r.error}`);
  ok(r.ok && r.data.soLoi === 0, `khong cau nao loi (${r.ok ? r.data.soLoi : '?'})`);

  c = await noi();
  const [sau] = await c.query(`SELECT COUNT(*) n FROM \`${db}\`.nguoi_dung`);
  ok(Number(sau[0].n) === Number(truoc[0].n), `so dong khop sau khi nhap: ${sau[0].n}`);
  const [bangSau] = await c.query(
    `SELECT TABLE_NAME t, TABLE_TYPE l FROM information_schema.TABLES WHERE TABLE_SCHEMA='${db}' ORDER BY t`);
  ok(bangSau.length === 5, `khoi phuc du 5 doi tuong: ${bangSau.map((x) => x.t).join(', ')}`);
  ok(bangSau.some((x) => x.t === 'v_nguoi_dung' && x.l === 'VIEW'), 'view duoc khoi phuc dung kieu');

  // du lieu that su giong, khong chi dung so luong
  const [gt] = await c.query(`SELECT ten, email, diem FROM \`${db}\`.nguoi_dung ORDER BY id`);
  ok(gt[0].ten === 'An' && gt[1].email === null && String(gt[2].diem) === '99.99',
     `gia tri khop: ${JSON.stringify(gt.map((x) => [x.ten, x.email, String(x.diem)]))}`);
  // cot sinh tu dong van tinh lai dung
  const [cs] = await c.query(`SELECT thanh_tien FROM \`${db}\`.co_cot_sinh ORDER BY id`);
  ok(String(cs[0].thanh_tien) === '300.00', `cot STORED GENERATED tinh lai dung: ${cs[0].thanh_tien}`);
  await c.end();

  /* ---------------- gap loi khi nhap ---------------- */
  const fLoi = path.join(TAM, 'co-loi.sql');
  fs.writeFileSync(fLoi,
    "CREATE TABLE ok1 (x INT);\nSELEC sai cu phap;\nCREATE TABLE ok2 (x INT);\n");
  datTepMo(fLoi); tepHienTai = fLoi;
  r = await nhap({ boQuaLoi: false });
  ok(!r.ok && /#2/.test(r.error), `dung ngay khi loi, bao dung so thu tu: "${r.error}"`);

  c = await noi();
  const [conLai] = await c.query(
    `SELECT COUNT(*) n FROM information_schema.TABLES WHERE TABLE_SCHEMA='${db}' AND TABLE_NAME='ok2'`);
  ok(Number(conLai[0].n) === 0, 'dung lai nen ok2 chua duoc tao');
  await c.end();

  // Lan nhap truoc da kip tao ok1 roi moi dung; khong don thi lan nay
  // `CREATE TABLE ok1` se bao "da ton tai" va thanh mot loi thu hai.
  c = await noi();
  await c.query(`DROP TABLE \`${db}\`.ok1`);
  await c.end();

  datTepMo(fLoi); tepHienTai = fLoi;
  r = await nhap({ boQuaLoi: true });
  ok(r.ok && r.data.soLoi === 1,
     `bo qua loi: chay tiep, dung ${r.ok ? r.data.soLoi : '?'} cau loi`);
  ok(r.ok && r.data.loi[0].thuTu === 2 && /SELEC/.test(r.data.loi[0].cau),
     `bao dung cau nao loi: #${r.ok ? r.data.loi[0].thuTu : '?'}`);
  c = await noi();
  const [co2] = await c.query(
    `SELECT COUNT(*) n FROM information_schema.TABLES WHERE TABLE_SCHEMA='${db}' AND TABLE_NAME='ok2'`);
  ok(Number(co2[0].n) === 1, 'bo qua loi nen ok2 da duoc tao');
  await c.end();

  /* ---------------- huy hop thoai ---------------- */
  huyHopThoai();
  r = await run(`window.api.sql.chonTepLuu(${JSON.stringify(db)}, "nguoi_dung")`);
  ok(r.ok && r.data.huy === true, 'huy hop thoai luu -> {huy:true}, khong nem loi');
  r = await run(`window.api.sql.chonTepMo(${JSON.stringify(db)})`);
  ok(r.ok && r.data.huy === true, 'huy hop thoai mo -> {huy:true}');

  // thieu duong dan thi phai bao loi ro rang chu khong im lang
  r = await run(`window.api.sql.xuat("${cid}", ${JSON.stringify(db)}, "nguoi_dung", {}, null)`);
  ok(!r.ok && /Thiếu đường dẫn/.test(r.error), `xuat khong co duong dan -> "${r.error}"`);

  /* ---------------- tien do va hop ket qua ---------------- */
  // Hai loi nguoi dung bao: khong thay thanh tien do, khong thay thong bao.
  // Nguyen nhan la hop chon tep nam trong chinh handler nen tien do bi che.
  datTepLuu(path.join(TAM, 'tiendo.sql'));
  await run(`window.__soTD = 0;
    window.api.onTienDo(() => { window.__soTD++; }); 'ok';`);
  await run(`(() => { const c = window.__tableu.state.connections[0];
    window.__tableu.moXuat(c, ${JSON.stringify(db)}, 'nguoi_dung'); })(); 'ok';`);
  ok(await run(`document.querySelector('#export-dialog').open`), 'hop tuy chon xuat mo ra');
  ok(!(await run(`document.querySelector('#progress-dialog').open`)),
     'tien do CHUA mo khi moi bam chuot phai');

  await run(`document.querySelector('#export-form')
    .dispatchEvent(new Event('submit', { cancelable: true, bubbles: true })); 'ok';`);
  await ctx.doiToi(`document.querySelector('#ketqua-dialog').open`, 'hop ket qua hien ra');
  ok(true, 'xong viec thi hien hop ket qua, khong chi mot dong o thanh trang thai');
  ok(await run(`window.__soTD`) > 0, `co nhan su kien tien do (${await run('window.__soTD')} lan)`);

  const kq = await run(`JSON.stringify({
    tieuDe: document.querySelector('#kq-title').textContent,
    nhan: [...document.querySelectorAll('#kq-list dt')].map(x => x.textContent),
    coNutThuMuc: !document.querySelector('#kq-thu-muc').hidden,
    hong: document.querySelector('#kq-icon').classList.contains('hong') })`);
  const k = JSON.parse(kq);
  ok(!k.hong && /Đã xuất bảng nguoi_dung/.test(k.tieuDe), `hop ket qua bao thanh cong: "${k.tieuDe}"`);
  ok(k.nhan.includes('Số dòng') && k.nhan.includes('Kích thước') && k.nhan.includes('Tệp'),
     `hien du thong tin: ${k.nhan.join(', ')}`);
  ok(k.coNutThuMuc, 'co nut mo thu muc chua tep');
  await run(`document.querySelector('#kq-dong').click(); 'ok';`);

  // that bai cung phai hien hop ket qua, khong duoc im lang
  datTepLuu('/khong/ton/tai/duoc/x.sql');
  await run(`(() => { const c = window.__tableu.state.connections[0];
    window.__tableu.moXuat(c, ${JSON.stringify(db)}, 'nguoi_dung'); })(); 'ok';`);
  await run(`document.querySelector('#export-form')
    .dispatchEvent(new Event('submit', { cancelable: true, bubbles: true })); 'ok';`);
  await ctx.doiToi(`document.querySelector('#ketqua-dialog').open`, 'hop ket qua hien khi hong');
  ok(await run(`document.querySelector('#kq-icon').classList.contains('hong')`),
     'hong thi hien dau hieu that bai');
  ok((await run(`document.querySelector('#kq-loi').textContent`)).length > 5,
     'co hien noi dung loi');
  await run(`document.querySelector('#kq-dong').click(); 'ok';`);

  fs.rmSync(TAM, { recursive: true, force: true });
}

module.exports = { chay };
