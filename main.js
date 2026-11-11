'use strict';

const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const mysql = require('mysql2');
const mysqlp = require('mysql2/promise');
const { xuat } = require('./lib/xuat-sql');
const { nhap } = require('./lib/nhap-sql');
const { hienThi: versionHienThi } = require('./lib/version');
const { moTunnel } = require('./lib/ssh-tunnel');

const CONFIG_FILE = () => path.join(app.getPath('userData'), 'connections.json');

let win = null;
/** key: `${connId}::${database}` -> pool */
const pools = new Map();
/** connId -> { cong, dong } — mot duong ham dung chung cho moi pool cua ket noi do */
const tunnels = new Map();

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
    {
      label: 'Trợ giúp',
      submenu: [
        { label: 'Giới thiệu TableU', click: () => send('menu:about') },
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

function sshCfg(cfg) {
  return {
    host: cfg.sshHost, port: cfg.sshPort || 22, user: cfg.sshUser,
    matKhau: cfg.sshMatKhau, khoaRiengTu: cfg.sshKhoa || '',
    passphrase: cfg.sshPassphrase,
    // Dich la dia chi MySQL NHIN TU PHIA MAY CHU SSH, khong phai tu may nay.
    dichHost: cfg.host || '127.0.0.1', dichCong: Number(cfg.port) || 3306,
  };
}

// Tra ve dia chi ma mysql2 nen noi toi: hoac thang den MySQL, hoac toi dau
// nay cua duong ham. Mot ket noi dung chung mot duong ham cho moi database.
async function diaChiToi(cfg, connId) {
  if (!cfg.sshBat) return { host: cfg.host, port: Number(cfg.port) || 3306 };
  if (connId && tunnels.has(connId)) {
    return { host: '127.0.0.1', port: tunnels.get(connId).cong };
  }
  const t = await moTunnel(sshCfg(cfg), () => {
    // Duong ham dut thi moi pool tro qua no deu thanh rac
    if (connId && tunnels.get(connId) === t) tunnels.delete(connId);
    if (connId) closePoolsFor(connId).catch(() => {});
  });
  if (connId) tunnels.set(connId, t);
  return { host: '127.0.0.1', port: t.cong, tam: connId ? null : t };
}

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
  const dc = await diaChiToi(cfg, connId);
  const pool = mysqlp.createPool(connConfig({ ...cfg, host: dc.host, port: dc.port }, database));

  // MySQL 8 cache thong ke bang trong data dictionary, mac dinh 86400 giay.
  // Khong tat thi TABLE_ROWS o information_schema dung yen ca ngay: them
  // hang chuc nghin dong ma cay ben trai van bao so cu, bam "Lam moi" cung
  // vo ich. Dat o muc connection vi day la bien phien.
  // MariaDB khong co bien nay -> nuot loi, khong sao.
  pool.pool.on('connection', (c) => {
    c.query('SET SESSION information_schema_stats_expiry = 0', () => {});
  });

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
  const t = tunnels.get(connId);
  if (t) { tunnels.delete(connId); try { t.dong(); } catch { /* ignore */ } }
}

async function closeAllPools() {
  for (const [key, pool] of [...pools.entries()]) {
    pools.delete(key);
    try { await pool.end(); } catch { /* ignore */ }
  }
  for (const [id, t] of [...tunnels.entries()]) {
    tunnels.delete(id);
    try { t.dong(); } catch { /* ignore */ }
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
  // Danh dau ro thay vi lang le them "…": UI can biet day la ban cat de con
  // tai gia tri day du khi nguoi dung mo bang chi tiet.
  if (s.length > MAX_CELL) return { text: s.slice(0, MAX_CELL), cat: true, dai: s.length };
  return s;
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

/* ------------------------------------------------------- nhap / xuat SQL */

// Bao tien do ve renderer. Chan bot nhip: mot ban dump lon co the goi ham nay
// hang chuc nghin lan, gui het qua IPC la phi.
function taoBaoTienDo(viec) {
  let lanCuoi = 0;
  return (xong, tong, phu = {}) => {
    const gio = Date.now();
    if (gio - lanCuoi < 150 && xong !== tong) return;
    lanCuoi = gio;
    send('sql:progress', { viec, xong, tong, ...phu });
  };
}

handle('sql:chonTepLuu', async (database, bang) => {
  const goiY = bang ? `${database}.${bang}.sql` : `${database}.sql`;
  const hop = await dialog.showSaveDialog(win, {
    title: bang ? `Xuất bảng ${bang}` : `Xuất database ${database}`,
    defaultPath: path.join(app.getPath('downloads'), goiY),
    filters: [{ name: 'SQL', extensions: ['sql'] }],
  });
  if (hop.canceled || !hop.filePath) return { huy: true };
  return { duongDan: hop.filePath };
});

handle('sql:chonTepMo', async (database) => {
  const hop = await dialog.showOpenDialog(win, {
    title: `Nhập vào database ${database}`,
    defaultPath: app.getPath('downloads'),
    filters: [{ name: 'SQL', extensions: ['sql'] }],
    properties: ['openFile'],
  });
  if (hop.canceled || !hop.filePaths.length) return { huy: true };
  return { duongDan: hop.filePaths[0] };
});

handle('app:chonTepKhoa', async () => {
  const hop = await dialog.showOpenDialog(win, {
    title: 'Chọn tệp khóa riêng SSH',
    defaultPath: path.join(app.getPath('home'), '.ssh'),
    properties: ['openFile', 'showHiddenFiles'],
  });
  if (hop.canceled || !hop.filePaths.length) return { huy: true };
  return { duongDan: hop.filePaths[0] };
});

handle('app:showInFolder', async (duongDan) => {
  if (!fs.existsSync(duongDan)) throw new Error('Tệp không còn tồn tại.');
  shell.showItemInFolder(duongDan);
  return true;
});

handle('sql:export', async (connId, database, bang, opts = {}, duongDan) => {
  if (!duongDan) throw new Error('Thiếu đường dẫn tệp.');
  const hop = { filePath: duongDan };
  const pool = await getPool(connId, database);
  const stream = fs.createWriteStream(hop.filePath, { encoding: 'utf8' });

  // WriteStream bao loi qua su kien 'error' chu khong throw. Khong bat thi
  // duong dan khong ghi duoc se lam ca thao tac treo im lang — nguoi dung
  // khong thay bao loi, cung khong thay gi xong ca.
  const loiGhi = new Promise((_, rej) => {
    stream.once('error', (e) => rej(new Error(`Không ghi được tệp: ${e.message}`)));
  });
  loiGhi.catch(() => {});   // tranh canh bao khi xuat chay tron

  const batDau = Date.now();
  try {
    const kq = await Promise.race([
      xuat(pool, { database, bang, opts, stream, tienDo: taoBaoTienDo('xuat') }),
      loiGhi,
    ]);
    await Promise.race([
      new Promise((res, rej) => stream.end((e) => (e ? rej(e) : res()))),
      loiGhi,
    ]);
    return {
      ...kq,
      duongDan: hop.filePath,
      kichThuoc: fs.statSync(hop.filePath).size,
      giay: ((Date.now() - batDau) / 1000).toFixed(1),
    };
  } catch (e) {
    stream.destroy();
    throw e;
  }
});

handle('sql:import', async (connId, database, opts = {}, duongDan) => {
  if (!duongDan) throw new Error('Thiếu đường dẫn tệp.');
  const pool = await getPool(connId, database);
  const batDau = Date.now();
  const kq = await nhap(pool, {
    duongDan,
    boQuaLoi: !!opts.boQuaLoi,
    tienDo: taoBaoTienDo('nhap'),
  });
  return { ...kq, duongDan, giay: ((Date.now() - batDau) / 1000).toFixed(1) };
});

handle('app:info', async () => {
  // Doc tu package.json chu khong ghi cung: doi ten/email/phien ban o mot cho.
  // package.json nam trong build.files nen van co mat trong ban dong goi (asar).
  const pkg = require('./package.json');
  const tacGia = typeof pkg.author === 'string' ? { name: pkg.author } : (pkg.author || {});
  return {
    // Khi dong goi, electron-builder ghi productName ra goc package.json;
    // luc dev thi no con nam trong khoi build, nen phai do ca hai cho.
    ten: pkg.productName || (pkg.build && pkg.build.productName) || app.getName(),
    // Doc thang tu package.json, khong dung app.getVersion(): khi entry point
    // khong nam canh package.json (vi du harness test) thi ham do tra ve
    // phien ban cua chinh Electron.
    phienBan: versionHienThi(pkg.version || app.getVersion()),
    moTa: pkg.description || '',
    tacGia: tacGia.name || '',
    email: tacGia.email || '',
    giayPhep: pkg.license || '',
  };
});

// Mo lien ket bang ung dung ngoai. CSP cua trang la default-src 'none' nen
// renderer khong tu dieu huong mailto: duoc. Chan giao thuc de openExternal
// khong tro thanh cho thuc thi tuy y.
const GIAO_THUC_CHO_PHEP = new Set(['mailto:', 'https:']);

handle('app:openExternal', async (url) => {
  let u;
  try { u = new URL(String(url)); } catch { throw new Error('Liên kết không hợp lệ.'); }
  if (!GIAO_THUC_CHO_PHEP.has(u.protocol)) {
    throw new Error(`Không mở giao thức ${u.protocol}`);
  }
  await shell.openExternal(u.href);
  return true;
});

// Che ca hai mat khau khi gui sang renderer; form gui lai dau che thi giu nguyen.
const CHE = '••••';
const cheMatKhau = (c) => ({
  ...c,
  password: c.password ? CHE : '',
  sshMatKhau: c.sshMatKhau ? CHE : '',
  sshPassphrase: c.sshPassphrase ? CHE : '',
});

handle('conn:list', async () => loadConnections().map(cheMatKhau));

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
    password: input.password === CHE && existing ? existing.password : (input.password || ''),
    database: (input.database || '').trim(),

    sshBat: !!input.sshBat,
    sshHost: (input.sshHost || '').trim(),
    sshPort: Number(input.sshPort) || 22,
    sshUser: (input.sshUser || '').trim(),
    sshKhoa: (input.sshKhoa || '').trim(),
    sshMatKhau: input.sshMatKhau === CHE && existing ? existing.sshMatKhau : (input.sshMatKhau || ''),
    sshPassphrase: input.sshPassphrase === CHE && existing
      ? existing.sshPassphrase : (input.sshPassphrase || ''),
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
  // Form gui dau che thi lay lai gia tri da luu
  const daLuu = input.id ? loadConnections().find((c) => c.id === input.id) : null;
  if (daLuu) {
    cfg = { ...input };
    for (const k of ['password', 'sshMatKhau', 'sshPassphrase']) {
      if (input[k] === CHE) cfg[k] = daLuu[k];
    }
  }

  // Ket noi chua luu thi chua co connId — dung duong ham tam, dong ngay sau khi thu.
  let tam = null;
  try {
    if (cfg.sshBat) {
      tam = await moTunnel(sshCfg(cfg));
      cfg = { ...cfg, host: '127.0.0.1', port: tam.cong, sshBat: false };
    }
    const c = await mysqlp.createConnection(connConfig(cfg, cfg.database || undefined));
    try {
      const [rows] = await c.query('SELECT VERSION() AS v');
      return { version: rows[0].v, quaSsh: !!input.sshBat };
    } finally {
      await c.end();
    }
  } finally {
    if (tam) tam.dong();
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

handle('db:insertRow', async (connId, database, table, giaTri) => {
  const pool = await getPool(connId, database);
  const meta = await tableMeta(pool, table);

  // Chi nhan cot co that va khong phai cot sinh tu dong. Cot khong duoc nhac
  // den thi bo han khoi INSERT de MySQL dung mac dinh / auto_increment.
  const cot = [];
  const tri = [];
  for (const [ten, v] of Object.entries(giaTri || {})) {
    if (!meta.fields.includes(ten)) throw new Error(`Không có cột ${ten} trong bảng.`);
    if (meta.generated.includes(ten)) {
      throw new Error(`Cột ${ten} là cột sinh tự động, không đặt giá trị được.`);
    }
    cot.push(mysql.escapeId(ten));
    tri.push(v);
  }

  const sql = cot.length
    ? `INSERT INTO ${mysql.escapeId(table)} (${cot.join(',')})
         VALUES (${cot.map(() => '?').join(',')})`
    : `INSERT INTO ${mysql.escapeId(table)} () VALUES ()`;
  const [r] = await pool.query(sql, tri);

  return {
    affectedRows: r.affectedRows ?? 0,
    insertId: r.insertId ? String(r.insertId) : null,
    soCot: cot.length,
  };
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

// Hai thao tac pha huy. Ten bang luon qua escapeId, va server tu kiem tra
// bang co that trong database do khong — khong tin ten client gui len.
async function kiemBangTonTai(pool, database, bang) {
  const [r] = await pool.query(
    `SELECT TABLE_TYPE AS loai FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`, [database, bang]);
  if (!r.length) throw new Error(`Không tìm thấy ${database}.${bang}`);
  return r[0].loai;
}

// Doc nguyen gia tri mot o. Luoi cat o MAX_CELL cho nhe, nen khi nguoi dung
// mo bang chi tiet thi phai hoi lai DB. Tra toi da 2MB cho mot o.
const MAX_O_CHI_TIET = 2 * 1024 * 1024;

handle('db:cellValue', async (connId, database, table, keyValues, column) => {
  const pool = await getPool(connId, database);
  const meta = await tableMeta(pool, table);
  if (!meta.fields.includes(column)) throw new Error(`Không có cột ${column} trong bảng.`);
  const where = pkWhere(meta, keyValues);
  const [rows] = await pool.query(
    `SELECT ${mysql.escapeId(column)} AS v FROM ${mysql.escapeId(table)}
      WHERE ${where.sql} LIMIT 1`, where.params);
  if (!rows.length) throw new Error('Không còn dòng này nữa.');

  const v = rows[0].v;
  if (v === null) return { giaTri: null };
  if (Buffer.isBuffer(v)) {
    return { nhiPhan: true, soByte: v.length, giaTri: `0x${v.subarray(0, 4096).toString('hex')}` };
  }
  const s = typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v);
  return s.length > MAX_O_CHI_TIET
    ? { giaTri: s.slice(0, MAX_O_CHI_TIET), cat: true, dai: s.length }
    : { giaTri: s, dai: s.length };
});

handle('db:dropTable', async (connId, database, bang) => {
  const pool = await getPool(connId, database);
  const loai = await kiemBangTonTai(pool, database, bang);
  const gi = loai === 'VIEW' ? 'VIEW' : 'TABLE';
  await pool.query(`DROP ${gi} ${mysql.escapeId(bang)}`);
  return { bang, loai: gi };
});

handle('db:truncateTable', async (connId, database, bang) => {
  const pool = await getPool(connId, database);
  const loai = await kiemBangTonTai(pool, database, bang);
  if (loai === 'VIEW') throw new Error('View không có dữ liệu riêng để xóa.');
  const [truoc] = await pool.query(`SELECT COUNT(*) AS n FROM ${mysql.escapeId(bang)}`);
  await pool.query(`TRUNCATE TABLE ${mysql.escapeId(bang)}`);
  return { bang, soDongDaXoa: Number(truoc[0].n) };
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
