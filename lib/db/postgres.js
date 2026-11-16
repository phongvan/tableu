'use strict';
// Driver PostgreSQL.
//
// Khac MySQL o ba cho can nho:
//  1. Mot ket noi gan voi MOT database; khong "USE" sang cai khac duoc. Nen
//     cap hai cua cay la SCHEMA chu khong phai database.
//  2. Dinh danh boc bang dau nhay kep, va Postgres ha chu thuong moi dinh danh
//     khong boc nhay — nen luon boc.
//  3. Tham so la $1,$2… chu khong phai ?.
const { Pool, types } = require('pg');
const QueryStream = require('pg-query-stream');

// Giu ngay gio dang CHUOI nhu MySQL (dateStrings), de luoi hien dung thu ma
// database luu, khong phai ban doi mui gio cua JS.
for (const oid of [1082, 1083, 1114, 1184, 1266]) {
  types.setTypeParser(oid, (v) => v);
}

const SO = new Set([20, 21, 23, 26, 700, 701, 790, 1700]);
const NGAY = new Set([1082, 1083, 1114, 1184, 1186, 1266]);

const eid = (t) => `"${String(t).replace(/"/g, '""')}"`;
const eval_ = (v) => {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  if (Buffer.isBuffer(v)) return `'\\x${v.toString('hex')}'`;
  return `'${String(v).replace(/'/g, "''")}'`;
};

async function cotCuaBang(pool, schema, bang) {
  const r = await pool.query(
    `SELECT a.attname AS field,
            format_type(a.atttypid, a.atttypmod) AS type,
            NOT a.attnotnull AS nullable,
            pg_get_expr(d.adbin, d.adrelid) AS "default",
            CASE WHEN a.attgenerated = 's' THEN 'STORED GENERATED'
                 WHEN a.attidentity IN ('a','d') THEN 'identity'
                 WHEN pg_get_expr(d.adbin, d.adrelid) LIKE 'nextval(%' THEN 'auto_increment'
                 ELSE '' END AS extra,
            col_description(a.attrelid, a.attnum) AS comment,
            COALESCE(ix.indisprimary, false) AS is_pk
       FROM pg_attribute a
       JOIN pg_class c ON c.oid = a.attrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
       LEFT JOIN LATERAL (
         SELECT true AS indisprimary FROM pg_index i
          WHERE i.indrelid = c.oid AND i.indisprimary AND a.attnum = ANY(i.indkey)
          LIMIT 1) ix ON true
      WHERE n.nspname = $1 AND c.relname = $2 AND a.attnum > 0 AND NOT a.attisdropped
      ORDER BY a.attnum`, [schema, bang]);
  return r.rows.map((x) => ({
    field: x.field, type: x.type, nullable: x.nullable,
    key: x.is_pk ? 'PRI' : '', default: x.default, extra: x.extra, comment: x.comment,
  }));
}

module.exports = {
  loai: 'postgres',
  ten: 'PostgreSQL',
  congMacDinh: 5432,
  nhanCapHai: 'Schema',
  canDatabase: true,              // bat buoc dien database khi tao ket noi
  hoTroGhi: true,
  hoTroXuatNhap: false,           // xuat/nhap SQL chua lam cho Postgres

  escapeId: eid,
  escapeGiaTri: eval_,
  thamSo: (i) => `$${i}`,
  // Pool noi vao mot database, nen phai ghi ro schema truoc ten bang
  tenDayDu: (schema, bang) => `${eid(schema)}.${eid(bang)}`,
  // Mot ket noi Postgres gan voi MOT database; cap hai cua cay la schema,
  // KHONG phai database — dem schema di mo ket noi se bao "does not exist".
  databaseChoPool: (cfg) => cfg.database || 'postgres',

  async taoPool(cfg, database) {
    return new Pool({
      host: cfg.host || '127.0.0.1',
      port: Number(cfg.port) || 5432,
      user: cfg.user || 'postgres',
      password: cfg.password || '',
      database: database || cfg.database || 'postgres',
      max: 4,
      connectionTimeoutMillis: 10000,
    });
  },

  dongPool: (pool) => pool.end(),
  layConnection: (pool) => pool.connect(),

  limitUpdate: '',             // Postgres khong co LIMIT trong UPDATE/DELETE
  insertTraVe: true,

  async truyVan(pool, sql, params) {
    const r = await pool.query(sql, params || []);
    return r.rows;
  },

  async chay(pool, sql, params) {
    const r = await pool.query(sql, params || []);
    return {
      soDongAnhHuong: r.rowCount ?? 0,
      insertId: null,
      info: '',
      rows: r.rows || [],
    };
  },

  async docTheoDong(pool, sql, max, params) {
    const client = await pool.connect();
    try {
      const rows = [];
      let fields = null;
      let biCat = false;
      const st = client.query(new QueryStream(sql, params || [], { rowMode: 'array' }));
      await new Promise((resolve, reject) => {
        st.on('data', (row) => {
          if (!fields) fields = st.cursor && st.cursor._result ? st.cursor._result.fields : null;
          if (rows.length < max) rows.push(row);
          else if (!biCat) { biCat = true; st.destroy(); }
        });
        st.on('error', reject);
        st.on('end', resolve);
        st.on('close', resolve);
      });
      // Stream khong phoi fields on dinh -> hoi rieng mot dong de lay metadata
      if (!fields) {
        const r = await client.query({ text: `SELECT * FROM (${sql}) AS _t LIMIT 0`, rowMode: 'array' })
          .catch(() => null);
        fields = r ? r.fields : [];
      }
      return { rows, fields: fields || [], biCat };
    } finally {
      client.release();
    }
  },

  kieuCot(f) {
    const t = f.dataTypeID;
    if (SO.has(t)) return 'num';
    if (NGAY.has(t)) return 'time';
    if (t === 114 || t === 3802) return 'json';
    if (t === 16) return 'bool';
    if (t === 17) return 'blob';
    return 'text';
  },
  tenCot: (f) => f.name,
  bangCuaCot: () => '',
  laKhoaChinh: () => false,       // pg khong bao khoa chinh trong metadata ket qua
  khongDau: () => false,

  // "Database" o cay thuc chat la schema cua database dang noi
  async danhSachDatabase(pool) {
    const r = await pool.query(
      `SELECT nspname AS ten FROM pg_namespace
        WHERE nspname NOT LIKE 'pg\\_%' AND nspname <> 'information_schema'
        ORDER BY nspname`);
    return r.rows.map((x) => x.ten);
  },

  async danhSachBang(pool, schema) {
    const r = await pool.query(
      `SELECT c.relname AS name,
              CASE WHEN c.relkind IN ('v','m') THEN 'view' ELSE 'table' END AS kind,
              CASE WHEN c.reltuples < 0 THEN NULL ELSE c.reltuples::bigint END AS est_rows
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relkind IN ('r','p','v','m')
        ORDER BY c.relname`, [schema]);
    return r.rows.map((x) => ({
      name: x.name, kind: x.kind,
      estRows: x.est_rows === null ? null : Number(x.est_rows),
    }));
  },

  cotCuaBang,

  async chiMuc(pool, schema, bang) {
    const r = await pool.query(
      `SELECT i.relname AS name, a.attname AS column, ix.indisunique AS unique,
              am.amname AS type, k.ord AS seq
         FROM pg_index ix
         JOIN pg_class c ON c.oid = ix.indrelid
         JOIN pg_class i ON i.oid = ix.indexrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_am am ON am.oid = i.relam
         CROSS JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord)
         JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum
        WHERE n.nspname = $1 AND c.relname = $2
        ORDER BY i.relname, k.ord`, [schema, bang]);
    return r.rows.map((x) => ({
      name: x.name, column: x.column, unique: x.unique, type: x.type, seq: Number(x.seq),
    }));
  },

  // Postgres khong co SHOW CREATE TABLE — dung lai tu catalog.
  async ddl(pool, schema, bang) {
    const loai = await module.exports.loaiDoiTuong(pool, schema, bang);
    if (loai === 'view') {
      const v = await pool.query(
        'SELECT pg_get_viewdef($1::regclass, true) AS d', [`${eid(schema)}.${eid(bang)}`]);
      return `CREATE VIEW ${eid(schema)}.${eid(bang)} AS\n${(v.rows[0] || {}).d || ''}`;
    }
    const cols = await cotCuaBang(pool, schema, bang);
    const dong = cols.map((c) => {
      let s = `  ${eid(c.field)} ${c.type}`;
      if (c.extra === 'STORED GENERATED') s += ` GENERATED ALWAYS AS (${c.default}) STORED`;
      else if (c.default !== null) s += ` DEFAULT ${c.default}`;
      if (!c.nullable) s += ' NOT NULL';
      return s;
    });
    const pk = cols.filter((c) => c.key === 'PRI').map((c) => eid(c.field));
    if (pk.length) dong.push(`  PRIMARY KEY (${pk.join(', ')})`);

    const idx = await module.exports.chiMuc(pool, schema, bang);
    const phu = [];
    const daGom = new Set();
    for (const i of idx) {
      if (daGom.has(i.name) || /_pkey$/.test(i.name)) continue;
      daGom.add(i.name);
      const cot = idx.filter((x) => x.name === i.name).map((x) => eid(x.column)).join(', ');
      phu.push(`CREATE ${i.unique ? 'UNIQUE ' : ''}INDEX ${eid(i.name)} `
        + `ON ${eid(schema)}.${eid(bang)} USING ${i.type} (${cot});`);
    }
    return `CREATE TABLE ${eid(schema)}.${eid(bang)} (\n${dong.join(',\n')}\n);`
      + (phu.length ? `\n\n${phu.join('\n')}` : '');
  },

  async metaBang(pool, schema, bang) {
    const cols = await cotCuaBang(pool, schema, bang);
    return {
      fields: cols.map((c) => c.field),
      pk: cols.filter((c) => c.key === 'PRI').map((c) => c.field),
      nullable: cols.filter((c) => c.nullable).map((c) => c.field),
      generated: cols.filter((c) => c.extra === 'STORED GENERATED').map((c) => c.field),
      binaryPk: cols.some((c) => c.key === 'PRI' && /bytea/i.test(c.type)),
    };
  },

  async loaiDoiTuong(pool, schema, bang) {
    const r = await pool.query(
      `SELECT c.relkind AS k FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relname = $2`, [schema, bang]);
    if (!r.rows.length) return null;
    return ['v', 'm'].includes(r.rows[0].k) ? 'view' : 'table';
  },

  async schemaGoiY(pool, schema) {
    const r = await pool.query(
      `SELECT c.relname AS t, a.attname AS c
         FROM pg_attribute a
         JOIN pg_class c ON c.oid = a.attrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relkind IN ('r','p','v','m')
          AND a.attnum > 0 AND NOT a.attisdropped
        ORDER BY c.relname, a.attnum`, [schema]);
    return r.rows;
  },

  cauLenhXoaSach: (bang, schema) => `TRUNCATE TABLE ${eid(schema)}.${eid(bang)}`,
  cauLenhXoaBang: (bang, loai, schema) =>
    `DROP ${loai === 'view' ? 'VIEW' : 'TABLE'} ${eid(schema)}.${eid(bang)}`,
};
