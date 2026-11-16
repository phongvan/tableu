'use strict';
// Driver MySQL — gói nguyên hành vi vốn có, không đổi gì về mặt chức năng.
const mysql = require('mysql2');
const mysqlp = require('mysql2/promise');

const SO = new Set([0, 1, 2, 3, 4, 5, 8, 9, 13, 246]);
const NGAY = new Set([7, 10, 11, 12, 14]);
const NHI_PHAN = new Set([249, 250, 251, 252]);
const GENERATED = /\b(VIRTUAL|STORED) GENERATED\b/i;

const eid = (t) => mysql.escapeId(t);

async function cotCuaBang(pool, db, bang) {
  const [rows] = await pool.query(`SHOW FULL COLUMNS FROM ${eid(bang)}`);
  return rows.map((r) => ({
    field: r.Field, type: r.Type, nullable: r.Null === 'YES', key: r.Key,
    default: r.Default, extra: r.Extra, comment: r.Comment,
  }));
}

module.exports = {
  loai: 'mysql',
  ten: 'MySQL / MariaDB',
  congMacDinh: 3306,
  nhanCapHai: 'Database',        // Postgres gọi cấp này là "Schema"
  hoTroGhi: true,                // sửa ô / thêm dòng / xoá bảng
  hoTroXuatNhap: true,

  escapeId: eid,
  escapeGiaTri: (v) => mysql.escape(v),
  tenDayDu: (db, bang) => eid(bang),
  // Cap hai cua cay chinh la database -> pool noi thang vao no
  databaseChoPool: (cfg, capHai) => capHai || cfg.database || undefined,

  async taoPool(cfg, database) {
    const pool = mysqlp.createPool({
      host: cfg.host || '127.0.0.1',
      port: Number(cfg.port) || 3306,
      user: cfg.user || 'root',
      password: cfg.password || '',
      database: database || undefined,
      waitForConnections: true,
      connectionLimit: 4,
      charset: 'utf8mb4',
      dateStrings: true,
      supportBigNumbers: true,
      bigNumberStrings: true,
      multipleStatements: false,
      connectTimeout: 10000,
    });
    // MySQL 8 cache thong ke bang 24 tieng; khong tat thi "Lam moi" vo nghia
    pool.pool.on('connection', (c) => {
      c.query('SET SESSION information_schema_stats_expiry = 0', () => {});
    });
    return pool;
  },

  dongPool: (pool) => pool.end(),
  layConnection: (pool) => pool.getConnection(),

  thamSo: () => '?',
  limitUpdate: ' LIMIT 1',     // Postgres khong cho LIMIT trong UPDATE/DELETE
  insertTraVe: false,          // Postgres phai them RETURNING moi biet dong vua chen

  async truyVan(pool, sql, params) {
    const [rows] = await pool.query(sql, params || []);
    return rows;
  },

  // Cau lenh ghi: tra ve so dong anh huong theo dang chung cho moi driver
  async chay(pool, sql, params) {
    const [r] = await pool.query(sql, params || []);
    return {
      soDongAnhHuong: r.affectedRows ?? 0,
      insertId: r.insertId ? String(r.insertId) : null,
      info: r.info || '',
      rows: Array.isArray(r) ? r : [],
    };
  },

  // Doc theo dong, dung han khi du `max` — tranh gom ca bang vao bo nho.
  docTheoDong(pool, sql, max, params) {
    return new Promise((resolve, reject) => {
      const rows = [];
      let fields = null;
      let biCat = false;
      let xong = false;
      const ket = (fn, v) => { if (!xong) { xong = true; fn(v); } };
      const q = params && params.length
        ? pool.pool.query({ sql, rowsAsArray: true }, params)
        : pool.pool.query({ sql, rowsAsArray: true });
      const st = q.stream();
      st.on('fields', (f) => { fields = f; });
      st.on('data', (row) => {
        if (rows.length < max) rows.push(row);
        else if (!biCat) { biCat = true; st.destroy(); }
      });
      st.on('error', (e) => ket(reject, e));
      st.on('close', () => ket(resolve, { rows, fields, biCat }));
    });
  },

  kieuCot(f) {
    const t = f.columnType;
    if (SO.has(t)) return 'num';
    if (NGAY.has(t)) return 'time';
    if (t === 245) return 'json';
    if (t === 16) return 'bool';
    if (NHI_PHAN.has(t) && (f.flags & 128)) return 'blob';
    if (t === 247 || t === 248) return 'enum';
    return 'text';
  },
  tenCot: (f) => f.name,
  bangCuaCot: (f) => f.table || '',
  laKhoaChinh: (f) => !!(f.flags & 2),
  khongDau: (f) => !!(f.flags & 32),

  async danhSachDatabase(pool) {
    const [rows] = await pool.query('SHOW DATABASES');
    return rows.map((r) => Object.values(r)[0]);
  },

  async danhSachBang(pool, db) {
    const [rows] = await pool.query(
      `SELECT TABLE_NAME AS name, TABLE_TYPE AS type, TABLE_ROWS AS est_rows
         FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME`, [db]);
    return rows.map((r) => ({
      name: r.name,
      kind: r.type === 'VIEW' ? 'view' : 'table',
      estRows: r.est_rows === null ? null : Number(r.est_rows),
    }));
  },

  cotCuaBang,

  async chiMuc(pool, db, bang) {
    const [rows] = await pool.query(`SHOW INDEX FROM ${eid(bang)}`);
    return rows.map((r) => ({
      name: r.Key_name, column: r.Column_name,
      unique: Number(r.Non_unique) === 0, type: r.Index_type, seq: Number(r.Seq_in_index),
    }));
  },

  async ddl(pool, db, bang) {
    const [rows] = await pool.query(`SHOW CREATE TABLE ${eid(bang)}`);
    const r = rows[0] || {};
    return r['Create Table'] || r['Create View'] || '';
  },

  async metaBang(pool, db, bang) {
    const cols = await cotCuaBang(pool, db, bang);
    return {
      fields: cols.map((c) => c.field),
      pk: cols.filter((c) => c.key === 'PRI').map((c) => c.field),
      nullable: cols.filter((c) => c.nullable).map((c) => c.field),
      generated: cols.filter((c) => GENERATED.test(c.extra || '')).map((c) => c.field),
      binaryPk: cols.some((c) => c.key === 'PRI' && /blob|binary/i.test(c.type)),
    };
  },

  async loaiDoiTuong(pool, db, bang) {
    const [r] = await pool.query(
      `SELECT TABLE_TYPE AS loai FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`, [db, bang]);
    return r.length ? (r[0].loai === 'VIEW' ? 'view' : 'table') : null;
  },

  async schemaGoiY(pool, db) {
    const [rows] = await pool.query(
      `SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, ORDINAL_POSITION`, [db]);
    return rows;
  },

  cauLenhKhoaBang: (bang) => `LOCK TABLES ${eid(bang)} WRITE`,
  cauLenhMoKhoa: () => 'UNLOCK TABLES',
  cauLenhTatRangBuoc: () => 'SET FOREIGN_KEY_CHECKS=0',
  cauLenhBatRangBuoc: () => 'SET FOREIGN_KEY_CHECKS=1',
  cauLenhXoaSach: (bang) => `TRUNCATE TABLE ${eid(bang)}`,
  cauLenhXoaBang: (bang, loai) => `DROP ${loai === 'view' ? 'VIEW' : 'TABLE'} ${eid(bang)}`,
};
