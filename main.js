'use strict';

const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const mysql = require('mysql2');
const mysqlp = require('mysql2/promise');

const CONFIG_FILE = () => path.join(app.getPath('userData'), 'connections.json');

let win = null;
/** key: `${connId}::${database}` -> pool */
const pools = new Map();

/* ---------------------------------------------------------------- window */

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 560,
    backgroundColor: '#1e1f22',
    title: 'TableU',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.on('closed', () => { win = null; });
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(buildMenu());
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', async () => {
  await closeAllPools();
  app.quit();
});

function buildMenu() {
  return Menu.buildFromTemplate([
    {
      label: 'Tệp',
      submenu: [
        { label: 'Kết nối mới…', accelerator: 'CmdOrCtrl+N', click: () => send('menu:new-connection') },
        { label: 'Tab truy vấn mới', accelerator: 'CmdOrCtrl+T', click: () => send('menu:new-query') },
        { type: 'separator' },
        { label: 'Đóng tab', accelerator: 'CmdOrCtrl+W', click: () => send('menu:close-tab') },
        { role: 'quit', label: 'Thoát' },
      ],
    },
    {
      label: 'Xem',
      submenu: [
        { label: 'Làm mới', accelerator: 'F5', click: () => send('menu:refresh') },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Cỡ chữ mặc định' },
        { role: 'zoomIn', label: 'Phóng to' },
        { role: 'zoomOut', label: 'Thu nhỏ' },
        { type: 'separator' },
        { role: 'toggleDevTools', label: 'Công cụ nhà phát triển' },
        { role: 'reload', label: 'Tải lại' },
      ],
    },
  ]);
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

/* ------------------------------------------------------------- store */

function loadConnections() {
  try {
    const raw = fs.readFileSync(CONFIG_FILE(), 'utf8');
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function saveConnections(list) {
  const file = CONFIG_FILE();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(list, null, 2), { mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch { /* ignore */ }
}

/* -------------------------------------------------------------- pools */

function connConfig(cfg, database) {
  return {
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
  };
}

async function getPool(connId, database) {
  const key = `${connId}::${database || ''}`;
  if (pools.has(key)) return pools.get(key);
  const cfg = loadConnections().find((c) => c.id === connId);
  if (!cfg) throw new Error('Không tìm thấy kết nối đã lưu.');
  const pool = mysqlp.createPool(connConfig(cfg, database));
  pools.set(key, pool);
  return pool;
}

async function closePoolsFor(connId) {
  for (const [key, pool] of [...pools.entries()]) {
    if (key.startsWith(`${connId}::`)) {
      pools.delete(key);
      try { await pool.end(); } catch { /* ignore */ }
    }
  }
}

async function closeAllPools() {
  for (const [key, pool] of [...pools.entries()]) {
    pools.delete(key);
    try { await pool.end(); } catch { /* ignore */ }
  }
}

/* --------------------------------------------------------- serializing */

const MAX_CELL = 4096;

function cell(v) {
  if (v === null || v === undefined) return null;
  if (Buffer.isBuffer(v)) {
    if (v.length <= 32) return { blob: `0x${v.toString('hex')}`, bytes: v.length };
    return { blob: `(BLOB ${v.length} bytes)`, bytes: v.length };
  }
  if (typeof v === 'object') return JSON.stringify(v);
  const s = String(v);
  return s.length > MAX_CELL ? `${s.slice(0, MAX_CELL)}…` : s;
}

// ma kieu cot cua MySQL -> nhom de to mau tren luoi
const NUMERIC = new Set([0, 1, 2, 3, 4, 5, 8, 9, 13, 246]);
const TEMPORAL = new Set([7, 10, 11, 12, 14]);
const BINARY = new Set([249, 250, 251, 252]);

function colKind(f) {
  const t = f.columnType;
  if (NUMERIC.has(t)) return 'num';
  if (TEMPORAL.has(t)) return 'time';
  if (t === 245) return 'json';
  if (t === 16) return 'bool';
  // BLOB/TEXT deu la ma 252; co co BINARY (128) thi moi that su la blob
  if (BINARY.has(t) && (f.flags & 128)) return 'blob';
  if (t === 247 || t === 248) return 'enum';
  return 'text';
}

function shapeResult(rows, fields) {
  const cols = (fields || []).map((f) => ({
    name: f.name,
    table: f.table || '',
    kind: colKind(f),
    pk: !!(f.flags & 2),
    unsigned: !!(f.flags & 32),
  }));
  const data = Array.isArray(rows) ? rows.map((r) => (Array.isArray(r) ? r.map(cell) : [])) : [];
  return { columns: cols, rows: data };
}

/* ------------------------------------------------------- sua du lieu */

// Cot sinh tu bieu thuc thi MySQL cam UPDATE. Luu y phan biet voi
// DEFAULT_GENERATED (vi du `ON UPDATE CURRENT_TIMESTAMP`) — cai do van sua duoc.
const GENERATED = /\b(VIRTUAL|STORED) GENERATED\b/i;

async function tableMeta(pool, table) {
  const [cols] = await pool.query(`SHOW FULL COLUMNS FROM ${mysql.escapeId(table)}`);
  return {
    fields: cols.map((c) => c.Field),
    pk: cols.filter((c) => c.Key === 'PRI').map((c) => c.Field),
    nullable: cols.filter((c) => c.Null === 'YES').map((c) => c.Field),
    generated: cols.filter((c) => GENERATED.test(c.Extra || '')).map((c) => c.Field),
    binaryPk: cols.some((c) => c.Key === 'PRI' && /blob|binary/i.test(c.Type)),
  };
}

// Menh de WHERE dinh vi dung mot dong. Ten cot khoa LUON do server tu doc ra tu
// SHOW FULL COLUMNS — client chi gui gia tri. Neu de client gui ca ten cot thi
// mot loi phia renderer co the bien thanh UPDATE quet ca bang.
function pkWhere(meta, keyValues) {
  if (!meta.pk.length) {
    throw new Error('Bảng không có khóa chính nên không xác định được dòng cần sửa.');
  }
  if (meta.binaryPk) {
    throw new Error('Khóa chính kiểu nhị phân, chưa hỗ trợ sửa trên lưới.');
  }
  if (!Array.isArray(keyValues) || keyValues.length !== meta.pk.length) {
    throw new Error('Thiếu giá trị khóa chính của dòng.');
  }
  return {
    sql: meta.pk.map((k) => `${mysql.escapeId(k)} = ?`).join(' AND '),
    params: keyValues,
  };
}

// Doc lai nguyen dong sau khi ghi: trigger, cot sinh tu dong va
// `ON UPDATE CURRENT_TIMESTAMP` deu co the doi nhung o khac.
async function readRow(pool, table, where) {
  const [rows, fields] = await pool.query({
    sql: `SELECT * FROM ${mysql.escapeId(table)} WHERE ${where.sql} LIMIT 1`,
    rowsAsArray: true,
  }, where.params);
  if (!rows.length) return null;
  return shapeResult(rows, fields).rows[0];
}

/* ---------------------------------------------------------------- ipc */

function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return { ok: true, data: await fn(...args) };
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : String(err) };
    }
  });
}

handle('conn:list', async () => loadConnections().map((c) => ({ ...c, password: c.password ? '••••' : '' })));

handle('conn:save', async (input) => {
  const list = loadConnections();
  const id = input.id || crypto.randomUUID();
  const existing = list.find((c) => c.id === id);
  const record = {
    id,
    name: (input.name || '').trim() || `${input.user}@${input.host}`,
    host: (input.host || '').trim() || '127.0.0.1',
    port: Number(input.port) || 3306,
    user: (input.user || '').trim(),
    // giữ mật khẩu cũ nếu form gửi lên placeholder
    password: input.password === '••••' && existing ? existing.password : (input.password || ''),
    database: (input.database || '').trim(),
  };
  if (existing) Object.assign(existing, record);
  else list.push(record);
  saveConnections(list);
  await closePoolsFor(id);
  return { id };
});

handle('conn:delete', async (id) => {
  saveConnections(loadConnections().filter((c) => c.id !== id));
  await closePoolsFor(id);
  return true;
});

handle('conn:test', async (input) => {
  let cfg = input;
  if (input.password === '••••' && input.id) {
    const saved = loadConnections().find((c) => c.id === input.id);
    if (saved) cfg = { ...input, password: saved.password };
  }
  const c = await mysqlp.createConnection(connConfig(cfg, cfg.database || undefined));
  try {
    const [rows] = await c.query('SELECT VERSION() AS v');
    return { version: rows[0].v };
  } finally {
    await c.end();
  }
});

handle('db:databases', async (connId) => {
  const pool = await getPool(connId, null);
  const [rows] = await pool.query('SHOW DATABASES');
  return rows.map((r) => Object.values(r)[0]);
});

handle('db:tables', async (connId, database) => {
  const pool = await getPool(connId, database);
  const [rows] = await pool.query(
    `SELECT TABLE_NAME AS name, TABLE_TYPE AS type, TABLE_ROWS AS est_rows
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = ?
      ORDER BY TABLE_NAME`,
    [database],
  );
  return rows.map((r) => ({
    name: r.name,
    kind: r.type === 'VIEW' ? 'view' : 'table',
    estRows: r.est_rows === null ? null : Number(r.est_rows),
  }));
});

handle('db:columns', async (connId, database, table) => {
  const pool = await getPool(connId, database);
  const [rows] = await pool.query(`SHOW FULL COLUMNS FROM ${mysql.escapeId(table)}`);
  return rows.map((r) => ({
    field: r.Field,
    type: r.Type,
    nullable: r.Null === 'YES',
    key: r.Key,
    default: r.Default,
    extra: r.Extra,
    comment: r.Comment,
  }));
});

handle('db:indexes', async (connId, database, table) => {
  const pool = await getPool(connId, database);
  const [rows] = await pool.query(`SHOW INDEX FROM ${mysql.escapeId(table)}`);
  return rows.map((r) => ({
    name: r.Key_name,
    column: r.Column_name,
    unique: Number(r.Non_unique) === 0,
    type: r.Index_type,
    seq: Number(r.Seq_in_index),
  }));
});

handle('db:ddl', async (connId, database, table) => {
  const pool = await getPool(connId, database);
  const [rows] = await pool.query(`SHOW CREATE TABLE ${mysql.escapeId(table)}`);
  const row = rows[0] || {};
  return row['Create Table'] || row['Create View'] || '';
});

handle('db:rows', async (connId, database, table, opts = {}) => {
  const pool = await getPool(connId, database);
  const limit = Math.min(Math.max(Number(opts.limit) || 200, 1), 5000);
  const offset = Math.max(Number(opts.offset) || 0, 0);
  const where = (opts.where || '').trim();
  const whereSql = where ? ` WHERE ${where}` : '';
  let orderSql = '';
  if (opts.orderBy) {
    const dir = String(opts.orderDir).toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
    orderSql = ` ORDER BY ${mysql.escapeId(opts.orderBy)} ${dir}`;
  }
  const from = `FROM ${mysql.escapeId(table)}${whereSql}`;

  const started = Date.now();
  const [rows, fields] = await pool.query({
    sql: `SELECT * ${from}${orderSql} LIMIT ${limit} OFFSET ${offset}`,
    rowsAsArray: true,
  });
  const elapsed = Date.now() - started;

  // Khoa cua tung dong duoc gui rieng, khong lay lai tu o hien thi: cell() cat
  // chuoi dai va doi Buffer thanh object, dung lai se dinh sai dong.
  const meta = await tableMeta(pool, table);
  const pkIdx = meta.pk.map((name) => fields.findIndex((f) => f.name === name));
  const coDuKhoa = meta.pk.length > 0 && !pkIdx.includes(-1) && !meta.binaryPk;
  const keys = coDuKhoa ? rows.map((r) => pkIdx.map((i) => r[i])) : null;

  let total = null;
  if (opts.count !== false) {
    const [cnt] = await pool.query(`SELECT COUNT(*) AS n ${from}`);
    total = Number(cnt[0].n);
  }
  return {
    ...shapeResult(rows, fields),
    total, limit, offset, elapsed, keys,
    meta: {
      pk: meta.pk, generated: meta.generated, nullable: meta.nullable,
      suaDuoc: coDuKhoa,
      lyDo: coDuKhoa ? null
        : meta.binaryPk ? 'khóa chính kiểu nhị phân'
        : meta.pk.length ? 'thiếu cột khóa chính trong kết quả'
        : 'bảng/view không có khóa chính',
    },
  };
});

// Doc ket qua theo dong va DUNG han khi du `max`.
//
// Truoc day cho `pool.query` gom ca ket qua vao mang roi tra ve. Mot cau
// `SELECT * FROM daily` (161.608 dong x 54 cot) lam treo cung cua so: main
// process phai dung 8,7 trieu chuoi, day het qua IPC, roi renderer dung tung
// ay the <td>. Stream + destroy() cat o 1.001 dong het 33ms thay vi doc het
// mat 1,2 giay, va bo nho giu nguyen muc thap.
function truyVanCoGioiHan(pool, sql, max) {
  return new Promise((resolve, reject) => {
    const rows = [];
    let fields = null;
    let biCat = false;
    let xong = false;
    const ket = (fn, v) => { if (!xong) { xong = true; fn(v); } };

    const stream = pool.pool.query({ sql, rowsAsArray: true }).stream();
    stream.on('fields', (f) => { fields = f; });
    stream.on('data', (row) => {
      if (rows.length < max) rows.push(row);
      else if (!biCat) { biCat = true; stream.destroy(); }
    });
    stream.on('error', (e) => ket(reject, e));
    stream.on('close', () => ket(resolve, { rows, fields, biCat }));
  });
}

handle('db:query', async (connId, database, sql, maxRows) => {
  const pool = await getPool(connId, database || null);
  const gioiHan = Math.min(Math.max(Number(maxRows) || 1000, 1), 50000);
  const started = Date.now();
  const { rows, fields, biCat } = await truyVanCoGioiHan(pool, sql, gioiHan);
  const elapsed = Date.now() - started;

  // Khong co `fields` nghia la cau lenh khong tra ve bang ket qua;
  // khi do rows[0] la ResultSetHeader.
  if (!fields) {
    const h = rows[0] || {};
    return {
      kind: 'ok',
      affectedRows: h.affectedRows ?? 0,
      insertId: h.insertId ? String(h.insertId) : null,
      info: h.info || '',
      elapsed,
    };
  }
  return { kind: 'rows', ...shapeResult(rows, fields), elapsed, biCat, gioiHan };
});

// Danh sach bang + cot cua ca database, dung cho goi y trong tab truy van.
// Mot luot query cho ca schema, khong lap qua tung bang.
handle('db:schema', async (connId, database) => {
  const pool = await getPool(connId, database);
  const [rows] = await pool.query(
    `SELECT TABLE_NAME AS t, COLUMN_NAME AS c
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ?
      ORDER BY TABLE_NAME, ORDINAL_POSITION`,
    [database],
  );
  const tables = {};
  for (const r of rows) (tables[r.t] || (tables[r.t] = [])).push(r.c);
  return tables;
});

handle('db:updateCell', async (connId, database, table, keyValues, column, value) => {
  const pool = await getPool(connId, database);
  const meta = await tableMeta(pool, table);
  if (!meta.fields.includes(column)) throw new Error(`Không có cột ${column} trong bảng.`);
  if (meta.generated.includes(column)) {
    throw new Error(`Cột ${column} là cột sinh tự động, MySQL không cho sửa.`);
  }
  const where = pkWhere(meta, keyValues);

  const [res] = await pool.query(
    `UPDATE ${mysql.escapeId(table)} SET ${mysql.escapeId(column)} = ? WHERE ${where.sql} LIMIT 1`,
    [value, ...where.params],
  );
  if (res.affectedRows === 0) {
    throw new Error('Không khớp dòng nào — có thể dòng đã bị xóa hoặc khóa chính đã đổi.');
  }
  return { affectedRows: res.affectedRows, changed: res.changedRows, row: await readRow(pool, table, where) };
});

handle('db:deleteRow', async (connId, database, table, keyValues) => {
  const pool = await getPool(connId, database);
  const where = pkWhere(await tableMeta(pool, table), keyValues);
  const [res] = await pool.query(
    `DELETE FROM ${mysql.escapeId(table)} WHERE ${where.sql} LIMIT 1`, where.params,
  );
  if (res.affectedRows === 0) throw new Error('Không khớp dòng nào — có thể dòng đã bị xóa.');
  return { affectedRows: res.affectedRows };
});

handle('db:disconnect', async (connId) => { await closePoolsFor(connId); return true; });

handle('export:csv', async (suggestedName, csv) => {
  const res = await dialog.showSaveDialog(win, {
    title: 'Xuất CSV',
    defaultPath: path.join(app.getPath('downloads'), suggestedName),
    filters: [{ name: 'CSV', extensions: ['csv'] }],
  });
  if (res.canceled || !res.filePath) return { saved: false };
  fs.writeFileSync(res.filePath, `﻿${csv}`, 'utf8');
  return { saved: true, path: res.filePath };
});
