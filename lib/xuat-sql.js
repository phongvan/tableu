'use strict';
// Xuat bang / database ra tep .sql theo kieu mysqldump.
//
// Ghi THANG ra stream, khong gom vao bo nho: bang `daily` co 161.608 dong x 54
// cot, gom het vao chuoi la treo may — dung dung bug da tung xay ra o tab truy van.
const mysql = require('mysql2');

// Cac ma kieu so cua MySQL: xuat khong bao ngoac de ban dump sach.
// Phai dua vao metadata chu khong doan bang regex tren gia tri.
const KIEU_SO = new Set([0, 1, 2, 3, 4, 5, 8, 9, 13, 246]);
const KIEU_BIT = 16;

// Gom nhieu dong vao mot INSERT, nhung phai duoi max_allowed_packet.
// Mac dinh cua MySQL 8 la 64MB; 800KB la nguong an toan rong rai.
const NGUONG_GOI = 800 * 1024;

function literal(gt, maKieu) {
  if (gt === null || gt === undefined) return 'NULL';
  if (Buffer.isBuffer(gt)) return gt.length ? `0x${gt.toString('hex')}` : "''";
  if (maKieu === KIEU_BIT) return `b'${Number(gt).toString(2)}'`;
  if (KIEU_SO.has(maKieu)) {
    // bigNumberStrings/decimal tra ve chuoi; chi bo ngoac khi that su la so
    const s = String(gt);
    if (/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(s)) return s;
  }
  return mysql.escape(gt);
}

// stream.write() tra ve false khi bo dem day. Bo qua tin hieu nay thi bo nho
// phinh theo toc do doc MySQL chu khong theo toc do ghi dia.
function ghi(stream, chuoi) {
  if (stream.write(chuoi)) return null;
  return new Promise((r) => stream.once('drain', r));
}

async function ghiCho(stream, chuoi) {
  const cho = ghi(stream, chuoi);
  if (cho) await cho;
}

function tenDayDu(bang) {
  return mysql.escapeId(bang);
}

/* ------------------------------------------------------------- cau truc */

async function xuatCauTruc(pool, bang, loai, opts, stream) {
  const [r] = await pool.query(`SHOW CREATE TABLE ${tenDayDu(bang)}`);
  const row = r[0] || {};
  const ddl = row['Create Table'] || row['Create View'] || '';
  if (!ddl) return;

  await ghiCho(stream, `\n--\n-- Cấu trúc ${loai === 'view' ? 'view' : 'bảng'} ${bang}\n--\n\n`);
  if (opts.themDrop) {
    const gi = loai === 'view' ? 'VIEW' : 'TABLE';
    await ghiCho(stream, `DROP ${gi} IF EXISTS ${tenDayDu(bang)};\n`);
  }
  await ghiCho(stream, `${ddl};\n`);
}

/* -------------------------------------------------------------- du lieu */

async function xuatDuLieu(pool, bang, stream, tienDo) {
  const [dem] = await pool.query(`SELECT COUNT(*) AS n FROM ${tenDayDu(bang)}`);
  const tong = Number(dem[0].n);
  if (tong === 0) return 0;

  await ghiCho(stream, `\n--\n-- Dữ liệu bảng ${bang} (${tong} dòng)\n--\n\n`);
  await ghiCho(stream, `LOCK TABLES ${tenDayDu(bang)} WRITE;\n`);

  const dauInsert = `INSERT INTO ${tenDayDu(bang)} VALUES `;
  let goi = [];
  let coGoi = 0;
  let daXong = 0;
  let kieuCot = null;

  const xaGoi = async () => {
    if (!goi.length) return;
    await ghiCho(stream, `${dauInsert}${goi.join(',')};\n`);
    goi = [];
    coGoi = 0;
  };

  await new Promise((resolve, reject) => {
    const st = pool.pool.query({ sql: `SELECT * FROM ${tenDayDu(bang)}`, rowsAsArray: true }).stream();
    let xong = false;
    const ket = (fn, v) => { if (!xong) { xong = true; fn(v); } };

    st.on('fields', (f) => { kieuCot = f.map((x) => x.columnType); });
    st.on('data', (dong) => {
      const bo = `(${dong.map((v, i) => literal(v, kieuCot[i])).join(',')})`;
      goi.push(bo);
      coGoi += bo.length + 1;
      daXong++;
      if (coGoi < NGUONG_GOI) {
        if (tienDo && daXong % 5000 === 0) tienDo(daXong, tong);
        return;
      }
      // Tam dung doc MySQL trong luc ghi dia, neu khong hai ben lech toc do
      st.pause();
      xaGoi()
        .then(() => { if (tienDo) tienDo(daXong, tong); st.resume(); })
        .catch((e) => ket(reject, e));
    });
    st.on('error', (e) => ket(reject, e));
    st.on('close', () => ket(resolve));
  });

  await xaGoi();
  await ghiCho(stream, 'UNLOCK TABLES;\n');
  if (tienDo) tienDo(daXong, tong);
  return daXong;
}

/* ---------------------------------------------------------------- chinh */

async function xuat(pool, { database, bang, opts, stream, tienDo }) {
  const o = {
    cauTruc: opts.cauTruc !== false,
    duLieu: opts.duLieu !== false,
    themDrop: opts.themDrop !== false,
    ...opts,
  };

  const [bien] = await pool.query('SELECT VERSION() AS v');
  await ghiCho(stream,
    `-- Xuất bởi TableU\n`
    + `-- Database: ${database}\n`
    + `-- MySQL: ${bien[0].v}\n`
    + `-- Thời điểm: ${new Date().toISOString()}\n`
    + `--\n\n`
    + `SET NAMES utf8mb4;\n`
    + `SET FOREIGN_KEY_CHECKS=0;\n`
    + `SET SQL_MODE='NO_AUTO_VALUE_ON_ZERO';\n`);

  // Mot bang cu the, hoac ca database
  let danhSach;
  if (bang) {
    const [r] = await pool.query(
      `SELECT TABLE_NAME AS ten, TABLE_TYPE AS loai FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`, [database, bang]);
    if (!r.length) throw new Error(`Không tìm thấy bảng ${bang}`);
    danhSach = r;
  } else {
    const [r] = await pool.query(
      `SELECT TABLE_NAME AS ten, TABLE_TYPE AS loai FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = ? ORDER BY TABLE_TYPE, TABLE_NAME`, [database]);
    danhSach = r;
  }

  const ketQua = { soBang: 0, soView: 0, soDong: 0 };
  for (const [i, t] of danhSach.entries()) {
    const laView = t.loai === 'VIEW';
    if (tienDo) tienDo(0, 0, { bang: t.ten, thuTu: i + 1, tongBang: danhSach.length });

    if (o.cauTruc) await xuatCauTruc(pool, t.ten, laView ? 'view' : 'table', o, stream);
    // View khong co du lieu rieng
    if (o.duLieu && !laView) {
      ketQua.soDong += await xuatDuLieu(pool, t.ten, stream,
        (xong, tong) => tienDo && tienDo(xong, tong, { bang: t.ten, thuTu: i + 1, tongBang: danhSach.length }));
    }
    if (laView) ketQua.soView++; else ketQua.soBang++;
  }

  await ghiCho(stream, '\nSET FOREIGN_KEY_CHECKS=1;\n');
  return ketQua;
}

module.exports = { xuat, literal };
