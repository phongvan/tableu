'use strict';

/* ==== IIFE: giu bien cuc bo, tranh dung ten voi global cua contextBridge ==== */
(() => {

/* ---------------------------------------------------------------- utils */

const $ = (sel, root = document) => root.querySelector(sel);
const api = window.api;

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function unwrap(res) {
  if (!res || !res.ok) throw new Error((res && res.error) || 'Lỗi không xác định');
  return res.data;
}

function fmtNum(n) {
  return typeof n === 'number' ? n.toLocaleString('vi-VN') : n;
}

function status(text, isError) {
  const bar = $('#status');
  bar.textContent = text;
  bar.classList.toggle('error', !!isError);
}

function errText(e) {
  return e && e.message ? e.message : String(e);
}

/* ---------------------------------------------------------------- state */

const state = {
  connections: [],
  /** connId -> { open, live, databases, dbs: {name: {open, tables}}, error } */
  nodes: {},
  tabs: [],
  activeTabId: null,
  selectedKey: null,
  seq: 1,
};

/* ---------------------------------------------------------------- theme */

function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('theme', t); } catch { /* ignore */ }
}
applyTheme(
  (() => {
    try { return localStorage.getItem('theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); }
    catch { return 'dark'; }
  })(),
);
$('#btn-theme').onclick = () =>
  applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');

/* ----------------------------------------------------------- connection */

const dlg = $('#conn-dialog');

function openConnDialog(existing) {
  $('#conn-dialog-title').textContent = existing ? 'Sửa kết nối' : 'Kết nối mới';
  $('#f-id').value = existing ? existing.id : '';
  $('#f-name').value = existing ? existing.name : '';
  $('#f-host').value = existing ? existing.host : '127.0.0.1';
  $('#f-port').value = existing ? existing.port : 3306;
  $('#f-user').value = existing ? existing.user : 'root';
  $('#f-pass').value = existing ? existing.password : '';
  $('#f-db').value = existing ? existing.database || '' : '';
  setDialogMsg('');
  dlg.showModal();
  $('#f-name').focus();
}

function setDialogMsg(text, kind) {
  const m = $('#conn-msg');
  m.textContent = text;
  m.className = `dialog-msg ${kind || ''}`;
}

function readForm() {
  return {
    id: $('#f-id').value || undefined,
    name: $('#f-name').value,
    host: $('#f-host').value,
    port: $('#f-port').value,
    user: $('#f-user').value,
    password: $('#f-pass').value,
    database: $('#f-db').value,
  };
}

$('#btn-new-conn').onclick = () => openConnDialog(null);
$('#btn-cancel').onclick = () => dlg.close();

$('#btn-test').onclick = async () => {
  setDialogMsg('Đang kiểm tra…');
  const res = await api.conn.test(readForm());
  if (res.ok) setDialogMsg(`Kết nối được — MySQL ${res.data.version}`, 'ok');
  else setDialogMsg(res.error, 'error');
};

$('#conn-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const res = await api.conn.save(readForm());
  if (!res.ok) { setDialogMsg(res.error, 'error'); return; }
  dlg.close();
  await reloadConnections();
});

async function reloadConnections() {
  try {
    state.connections = unwrap(await api.conn.list());
    for (const c of state.connections) {
      if (!state.nodes[c.id]) state.nodes[c.id] = { open: false, live: false, databases: null, dbs: {} };
    }
    renderTree();
  } catch (e) {
    status(errText(e), true);
  }
}

/* ------------------------------------------------------------- the tree */

const treeEl = $('#tree');
let treeFilter = '';

$('#tree-filter').addEventListener('input', (e) => {
  treeFilter = e.target.value.trim().toLowerCase();
  renderTree();
});

function node({ depth, cls, twisty, icon, label, meta, key, onClick, onDblClick, onContext }) {
  const n = el('div', `node depth-${depth} ${cls || ''}`);
  n.appendChild(el('span', 'twisty', twisty || ''));
  n.appendChild(el('span', 'ico', icon || ''));
  const lab = el('span', 'label', label);
  lab.title = label;
  n.appendChild(lab);
  if (meta) n.appendChild(el('span', 'meta', meta));
  if (key) {
    n.dataset.key = key;
    if (state.selectedKey === key) n.classList.add('selected');
    n.addEventListener('click', () => { state.selectedKey = key; renderTree(); });
  }
  if (onClick) n.addEventListener('click', onClick);
  if (onDblClick) n.addEventListener('dblclick', onDblClick);
  if (onContext) n.addEventListener('contextmenu', (e) => { e.preventDefault(); onContext(e); });
  return n;
}

function renderTree() {
  treeEl.textContent = '';
  if (state.connections.length === 0) {
    treeEl.appendChild(el('div', 'tree-empty', 'Chưa có kết nối nào.\nNhấn “+ Kết nối” ở trên.'));
    return;
  }

  for (const conn of state.connections) {
    const st = state.nodes[conn.id];
    treeEl.appendChild(node({
      depth: 0,
      cls: `conn ${st.live ? 'live' : ''}`,
      twisty: st.open ? '▼' : '▶',
      icon: '●',
      label: conn.name,
      meta: `${conn.host}:${conn.port}`,
      key: `c:${conn.id}`,
      onClick: () => toggleConn(conn),
      onContext: (e) => connMenu(e, conn),
    }));
    if (!st.open) continue;

    if (st.error) {
      treeEl.appendChild(el('div', 'tree-error', st.error));
      continue;
    }
    if (st.databases === null) {
      treeEl.appendChild(node({ depth: 1, cls: 'loading', label: 'Đang tải…' }));
      continue;
    }

    for (const dbName of st.databases) {
      const dbSt = st.dbs[dbName] || (st.dbs[dbName] = { open: false, tables: null, error: null });
      treeEl.appendChild(node({
        depth: 1,
        cls: 'db',
        twisty: dbSt.open ? '▼' : '▶',
        icon: '▣',
        label: dbName,
        key: `d:${conn.id}:${dbName}`,
        onClick: () => toggleDb(conn, dbName),
        onContext: (e) => dbMenu(e, conn, dbName),
      }));
      if (!dbSt.open) continue;

      if (dbSt.error) { treeEl.appendChild(el('div', 'tree-error', dbSt.error)); continue; }
      if (dbSt.tables === null) {
        treeEl.appendChild(node({ depth: 2, cls: 'loading', label: 'Đang tải…' }));
        continue;
      }

      const tables = treeFilter
        ? dbSt.tables.filter((t) => t.name.toLowerCase().includes(treeFilter))
        : dbSt.tables;

      if (tables.length === 0) {
        treeEl.appendChild(node({ depth: 2, cls: 'loading', label: treeFilter ? 'Không khớp' : 'Không có bảng' }));
        continue;
      }
      for (const t of tables) {
        treeEl.appendChild(node({
          depth: 2,
          cls: t.kind === 'view' ? 'tbl view' : 'tbl',
          icon: t.kind === 'view' ? '◫' : '▤',
          label: t.name,
          meta: t.estRows === null ? '' : `~${fmtNum(t.estRows)}`,
          key: `t:${conn.id}:${dbName}:${t.name}`,
          onDblClick: () => openDataTab(conn, dbName, t.name),
          onContext: (e) => tableMenu(e, conn, dbName, t.name),
        }));
      }
    }
  }
}

async function toggleConn(conn) {
  const st = state.nodes[conn.id];
  st.open = !st.open;
  st.error = null;
  renderTree();
  if (!st.open || st.databases !== null) return;
  try {
    status(`Đang kết nối ${conn.name}…`);
    st.databases = unwrap(await api.db.databases(conn.id));
    st.live = true;
    status(`Đã kết nối ${conn.name} — ${st.databases.length} database`);
    if (conn.database && st.databases.includes(conn.database)) {
      await toggleDb(conn, conn.database);
      return;
    }
  } catch (e) {
    st.error = errText(e);
    st.live = false;
    status(errText(e), true);
  }
  renderTree();
}

async function toggleDb(conn, dbName) {
  const dbSt = state.nodes[conn.id].dbs[dbName] || (state.nodes[conn.id].dbs[dbName] = { open: false, tables: null });
  dbSt.open = !dbSt.open;
  dbSt.error = null;
  renderTree();
  if (!dbSt.open || dbSt.tables !== null) return;
  try {
    dbSt.tables = unwrap(await api.db.tables(conn.id, dbName));
    status(`${dbName}: ${dbSt.tables.length} bảng`);
  } catch (e) {
    dbSt.error = errText(e);
    status(errText(e), true);
  }
  renderTree();
}

async function refreshDb(conn, dbName) {
  const dbSt = state.nodes[conn.id].dbs[dbName];
  if (!dbSt) return;
  dbSt.tables = null;
  renderTree();
  try {
    dbSt.tables = unwrap(await api.db.tables(conn.id, dbName));
  } catch (e) {
    dbSt.error = errText(e);
  }
  renderTree();
}

/* ---------------------------------------------------------- context menu */

const ctx = $('#ctx-menu');

function showMenu(e, items) {
  ctx.textContent = '';
  for (const it of items) {
    if (it === '-') { ctx.appendChild(el('div', 'sep')); continue; }
    const row = el('div', `item ${it.danger ? 'danger' : ''}`, it.label);
    row.onclick = () => { hideMenu(); it.run(); };
    ctx.appendChild(row);
  }
  ctx.hidden = false;
  const { innerWidth: w, innerHeight: h } = window;
  const r = ctx.getBoundingClientRect();
  ctx.style.left = `${Math.min(e.clientX, w - r.width - 8)}px`;
  ctx.style.top = `${Math.min(e.clientY, h - r.height - 8)}px`;
}
function hideMenu() { ctx.hidden = true; }
window.addEventListener('click', hideMenu);
window.addEventListener('blur', hideMenu);

function connMenu(e, conn) {
  showMenu(e, [
    { label: 'Sửa kết nối…', run: () => openConnDialog(conn) },
    { label: 'Ngắt kết nối', run: async () => {
      await api.conn.disconnect(conn.id);
      state.nodes[conn.id] = { open: false, live: false, databases: null, dbs: {} };
      renderTree();
      status(`Đã ngắt ${conn.name}`);
    } },
    '-',
    { label: 'Xóa kết nối', danger: true, run: async () => {
      if (!confirm(`Xóa kết nối “${conn.name}”?`)) return;
      unwrap(await api.conn.remove(conn.id));
      delete state.nodes[conn.id];
      for (const t of [...state.tabs]) if (t.connId === conn.id) closeTab(t.id);
      await reloadConnections();
    } },
  ]);
}

function dbMenu(e, conn, dbName) {
  showMenu(e, [
    { label: 'Tab truy vấn ở đây', run: () => openQueryTab(conn, dbName) },
    { label: 'Làm mới danh sách bảng', run: () => refreshDb(conn, dbName) },
    '-',
    { label: 'Sao chép tên', run: () => navigator.clipboard.writeText(dbName) },
  ]);
}

function tableMenu(e, conn, dbName, table) {
  showMenu(e, [
    { label: 'Xem dữ liệu', run: () => openDataTab(conn, dbName, table) },
    { label: 'Xem cấu trúc', run: () => openDataTab(conn, dbName, table, 'structure') },
    '-',
    { label: 'SELECT * trong tab query', run: () => openQueryTab(conn, dbName, `SELECT *\nFROM \`${table}\`\nLIMIT 200;`) },
    { label: 'Sao chép tên bảng', run: () => navigator.clipboard.writeText(table) },
  ]);
}

/* ----------------------------------------------------------------- tabs */

const tabbar = $('#tabbar');
const panes = $('#panes');

function renderTabs() {
  tabbar.textContent = '';
  for (const tab of state.tabs) {
    const t = el('div', `tab ${tab.type} ${tab.id === state.activeTabId ? 'active' : ''}`);
    t.dataset.tabId = tab.id;
    t.appendChild(el('span', 'tab-ico', tab.type === 'query' ? '▶' : '▤'));
    const lbl = el('span', 'tab-label', tab.title);
    lbl.title = tab.type === 'data' ? `${tab.database}.${tab.table}` : tab.title;
    t.appendChild(lbl);
    const x = el('span', 'close', '✕');
    x.onclick = (e) => { e.stopPropagation(); closeTab(tab.id); };
    t.appendChild(x);
    t.onclick = () => activateTab(tab.id);
    t.onauxclick = (e) => { if (e.button === 1) closeTab(tab.id); };
    tabbar.appendChild(t);
  }
  $('#empty-state').style.display = state.tabs.length ? 'none' : 'flex';
  updateTabOverflow();
}

/* Thanh tab an scrollbar (xem .tabbar trong styles.css), nen can:
   - lan chuot de truot ngang, vi Chromium khong tu quy deltaY sang cuon ngang
   - tu cuon toi tab dang chon, neu khong tab moi mo co the nam ngoai vung nhin
   - lam mo ria de biet con tab bi khuat */

function updateTabOverflow() {
  const max = tabbar.scrollWidth - tabbar.clientWidth;
  tabbar.classList.toggle('ovf-left', tabbar.scrollLeft > 1);
  tabbar.classList.toggle('ovf-right', max > 1 && tabbar.scrollLeft < max - 1);
}

// chuan hoa vi wheel co the bao theo pixel (0), dong (1) hoac trang (2)
function wheelPixels(e, axis) {
  const raw = axis === 'x' ? e.deltaX : e.deltaY;
  if (e.deltaMode === 1) return raw * 16;
  if (e.deltaMode === 2) return raw * tabbar.clientWidth;
  return raw;
}

tabbar.addEventListener('wheel', (e) => {
  if (tabbar.scrollWidth <= tabbar.clientWidth) return;
  const dx = wheelPixels(e, 'x');
  const dy = wheelPixels(e, 'y');
  const delta = Math.abs(dy) > Math.abs(dx) ? dy : dx;
  if (!delta) return;
  e.preventDefault();
  // scroll-behavior: smooth lam lan chuot bi tre, nen dat truc tiep khi lan
  const prev = tabbar.style.scrollBehavior;
  tabbar.style.scrollBehavior = 'auto';
  tabbar.scrollLeft += delta;
  tabbar.style.scrollBehavior = prev;
}, { passive: false });

tabbar.addEventListener('scroll', updateTabOverflow, { passive: true });
window.addEventListener('resize', updateTabOverflow);

// Do bang rect chu khong dung offsetLeft: offsetLeft tinh tu offsetParent
// (la <body>, vi .tabbar khong duoc position), nen lech dung bang be rong sidebar.
function scrollTabIntoView(id) {
  const node = tabbar.querySelector(`.tab[data-tab-id="${id}"]`);
  if (!node) return;
  const bar = tabbar.getBoundingClientRect();
  const t = node.getBoundingClientRect();
  const PAD = 36; // chua vua het dai mo dan o ria (34px) de tab khong bi mo

  if (t.width >= bar.width) {
    tabbar.scrollLeft += t.left - bar.left;      // tab rong hon thanh: canh mep trai
  } else if (t.left < bar.left + PAD) {
    tabbar.scrollLeft -= (bar.left + PAD) - t.left;
  } else if (t.right > bar.right - PAD) {
    tabbar.scrollLeft += t.right - (bar.right - PAD);
  }
}

function activateTab(id) {
  state.activeTabId = id;
  for (const t of state.tabs) t.pane.classList.toggle('active', t.id === id);
  renderTabs();
  scrollTabIntoView(id);
  const tab = state.tabs.find((t) => t.id === id);
  if (tab && tab.onFocus) tab.onFocus();
}

function closeTab(id) {
  const i = state.tabs.findIndex((t) => t.id === id);
  if (i < 0) return;
  state.tabs[i].pane.remove();
  state.tabs.splice(i, 1);
  if (state.activeTabId === id) {
    const next = state.tabs[i] || state.tabs[i - 1];
    state.activeTabId = next ? next.id : null;
    if (next) next.pane.classList.add('active');
  }
  renderTabs();
}

function addTab(tab) {
  state.tabs.push(tab);
  panes.appendChild(tab.pane);
  activateTab(tab.id);
  return tab;
}

/* ------------------------------------------------------------- grid */

const KIND_LABEL = {
  num: 'số', time: 'ngày giờ', text: 'văn bản', json: 'json',
  bool: 'bit', enum: 'enum', blob: 'nhị phân',
};

function renderGrid(container, result, opts = {}) {
  container.textContent = '';
  const table = el('table', 'grid');
  const thead = el('thead');
  const hr = el('tr');
  hr.appendChild(el('th', 'rownum', '#'));
  result.columns.forEach((col) => {
    const th = el('th', `${opts.onSort ? 'sortable' : ''} k-${col.kind || 'text'}`);
    if (col.pk) th.appendChild(el('span', 'pk', '⚿'));
    th.appendChild(document.createTextNode(col.name));
    if (opts.sortBy === col.name) th.appendChild(el('span', 'sort', opts.sortDir === 'DESC' ? '▼' : '▲'));
    if (col.kind && opts.showTypes !== false) {
      th.appendChild(el('span', 'ctype', KIND_LABEL[col.kind] || col.kind));
    }
    th.title = [col.table ? `${col.table}.${col.name}` : col.name, col.pk ? '(khóa chính)' : '']
      .filter(Boolean).join(' ');
    if (opts.onSort) th.onclick = () => opts.onSort(col.name);
    hr.appendChild(th);
  });
  thead.appendChild(hr);
  table.appendChild(thead);

  const tbody = el('tbody');
  const base = opts.offset || 0;
  result.rows.forEach((row, i) => {
    const tr = el('tr');
    tr.appendChild(el('td', 'rownum', String(base + i + 1)));
    row.forEach((v, ci) => {
      const kind = (result.columns[ci] && result.columns[ci].kind) || 'text';
      const td = el('td', `k-${kind}`);
      if (v === null) td.appendChild(el('span', 'null', 'NULL'));
      else if (typeof v === 'object' && v.blob) td.appendChild(el('span', 'blob', v.blob));
      else td.textContent = v;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  container.appendChild(table);

  if (result.rows.length === 0) {
    container.appendChild(el('div', 'msg dim', 'Không có dòng nào.'));
  }
}

function toCsv(result) {
  const esc = (v) => {
    if (v === null) return '';
    const s = typeof v === 'object' && v.blob ? v.blob : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = result.columns.map((c) => esc(c.name)).join(',');
  const body = result.rows.map((r) => r.map(esc).join(',')).join('\n');
  return `${head}\n${body}`;
}

async function exportCsv(name, result) {
  if (!result || result.rows.length === 0) { status('Không có dữ liệu để xuất', true); return; }
  const res = await api.exportCsv(name, toCsv(result));
  if (!res.ok) { status(res.error, true); return; }
  if (res.data.saved) status(`Đã lưu ${res.data.path}`);
}

/* --------------------------------------------------------- data tab */

function openDataTab(conn, database, table, initialView) {
  const existing = state.tabs.find(
    (t) => t.type === 'data' && t.connId === conn.id && t.database === database && t.table === table,
  );
  if (existing) { activateTab(existing.id); if (initialView) existing.showView(initialView); return; }

  const pane = el('div', 'pane');
  const tab = {
    id: `tab-${state.seq++}`,
    type: 'data',
    connId: conn.id,
    database,
    table,
    title: `${table}`,
    pane,
    view: initialView || 'data',
    q: { limit: 200, offset: 0, where: '', orderBy: null, orderDir: 'ASC' },
    result: null,
  };

  // sub tabs
  const subtabs = el('div', 'subtabs');
  const mk = (key, label) => {
    const s = el('div', 'subtab', label);
    s.onclick = () => tab.showView(key);
    subtabs.appendChild(s);
    return s;
  };
  const sData = mk('data', 'Dữ liệu');
  const sStruct = mk('structure', 'Cấu trúc');
  const sDdl = mk('ddl', 'DDL');
  pane.appendChild(subtabs);

  // toolbar
  const bar = el('div', 'pane-toolbar');
  const btnRefresh = el('button', 'btn ghost', '⟳');
  btnRefresh.title = 'Làm mới (F5)';
  const where = el('input', 'input where');
  where.type = 'text';
  where.placeholder = 'WHERE  ví dụ: status = 1 AND name LIKE \'%an%\'';
  const btnApply = el('button', 'btn', 'Lọc');
  const sel = el('select', 'input');
  for (const n of [100, 200, 500, 1000]) {
    const o = el('option', '', `${n} dòng`);
    o.value = String(n);
    if (n === 200) o.selected = true;
    sel.appendChild(o);
  }
  const btnCsv = el('button', 'btn ghost', 'CSV');
  btnCsv.title = 'Xuất kết quả hiện tại ra CSV';
  bar.append(btnRefresh, el('div', 'tb-sep'), where, btnApply, el('div', 'tb-sep'), sel, btnCsv);
  pane.appendChild(bar);

  const body = el('div', 'grid-wrap');
  pane.appendChild(body);

  // footer
  const footer = el('div', 'pane-footer');
  const info = el('span', 'info', '');
  const nav = el('div', 'nav');
  const bFirst = el('button', 'btn ghost', '«');
  const bPrev = el('button', 'btn ghost', '‹');
  const bNext = el('button', 'btn ghost', '›');
  const bLast = el('button', 'btn ghost', '»');
  nav.append(bFirst, bPrev, bNext, bLast);
  const spacer = el('div', 'spacer');
  spacer.style.flex = '1';
  footer.append(info, spacer, nav);
  pane.appendChild(footer);

  tab.showView = (v) => {
    tab.view = v;
    sData.classList.toggle('active', v === 'data');
    sStruct.classList.toggle('active', v === 'structure');
    sDdl.classList.toggle('active', v === 'ddl');
    bar.style.display = v === 'data' ? '' : 'none';
    footer.style.display = v === 'data' ? '' : 'none';
    if (v === 'data') loadData();
    else if (v === 'structure') loadStructure();
    else loadDdl();
  };

  async function loadData() {
    body.textContent = '';
    body.appendChild(el('div', 'msg', 'Đang tải…'));
    try {
      const r = unwrap(await api.db.rows(conn.id, database, table, tab.q));
      tab.result = r;
      renderGrid(body, r, {
        offset: r.offset,
        sortBy: tab.q.orderBy,
        sortDir: tab.q.orderDir,
        onSort: (name) => {
          if (tab.q.orderBy === name) tab.q.orderDir = tab.q.orderDir === 'ASC' ? 'DESC' : 'ASC';
          else { tab.q.orderBy = name; tab.q.orderDir = 'ASC'; }
          tab.q.offset = 0;
          loadData();
        },
      });
      const from = r.total === 0 ? 0 : r.offset + 1;
      const to = r.offset + r.rows.length;
      info.textContent = `${fmtNum(from)}–${fmtNum(to)} / ${fmtNum(r.total)} dòng · ${r.elapsed} ms`;
      bFirst.disabled = bPrev.disabled = r.offset === 0;
      bNext.disabled = bLast.disabled = to >= r.total;
      status(`${database}.${table}: ${fmtNum(r.total)} dòng`);
    } catch (e) {
      body.textContent = '';
      body.appendChild(el('div', 'msg error', errText(e)));
      info.textContent = '';
      status(errText(e), true);
    }
  }

  async function loadStructure() {
    body.textContent = '';
    body.appendChild(el('div', 'msg', 'Đang tải…'));
    try {
      const cols = unwrap(await api.db.columns(conn.id, database, table));
      const idx = unwrap(await api.db.indexes(conn.id, database, table));
      body.textContent = '';
      renderGrid(body, {
        columns: [
          { name: 'Cột', pk: false }, { name: 'Kiểu' }, { name: 'Null' },
          { name: 'Khóa' }, { name: 'Mặc định' }, { name: 'Extra' }, { name: 'Ghi chú' },
        ],
        rows: cols.map((c) => [
          c.field, c.type, c.nullable ? 'YES' : 'NO',
          c.key || null, c.default, c.extra || null, c.comment || null,
        ]),
      }, { showTypes: false });
      if (idx.length) {
        body.appendChild(el('div', 'grid-section', 'Chỉ mục'));
        const wrap = el('div', '');
        renderGrid(wrap, {
          columns: [{ name: 'Tên' }, { name: 'Cột' }, { name: 'Thứ tự' }, { name: 'Unique' }, { name: 'Kiểu' }],
          rows: idx.map((i) => [i.name, i.column, String(i.seq), i.unique ? 'YES' : 'NO', i.type]),
        }, { showTypes: false });
        body.appendChild(wrap);
      }
    } catch (e) {
      body.textContent = '';
      body.appendChild(el('div', 'msg error', errText(e)));
    }
  }

  async function loadDdl() {
    body.textContent = '';
    try {
      const ddl = unwrap(await api.db.ddl(conn.id, database, table));
      const pre = el('pre', 'ddl', ddl);
      body.appendChild(pre);
    } catch (e) {
      body.appendChild(el('div', 'msg error', errText(e)));
    }
  }

  btnRefresh.onclick = () => tab.showView(tab.view);
  btnApply.onclick = () => { tab.q.where = where.value; tab.q.offset = 0; loadData(); };
  where.onkeydown = (e) => { if (e.key === 'Enter') btnApply.onclick(); };
  sel.onchange = () => { tab.q.limit = Number(sel.value); tab.q.offset = 0; loadData(); };
  btnCsv.onclick = () => exportCsv(`${table}.csv`, tab.result);
  bFirst.onclick = () => { tab.q.offset = 0; loadData(); };
  bPrev.onclick = () => { tab.q.offset = Math.max(0, tab.q.offset - tab.q.limit); loadData(); };
  bNext.onclick = () => { tab.q.offset += tab.q.limit; loadData(); };
  bLast.onclick = () => {
    if (!tab.result) return;
    tab.q.offset = Math.max(0, Math.floor((tab.result.total - 1) / tab.q.limit) * tab.q.limit);
    loadData();
  };
  tab.onRefresh = () => tab.showView(tab.view);

  addTab(tab);
  tab.showView(tab.view);
}

/* -------------------------------------------------------- query tab */

function openQueryTab(conn, database, initialSql) {
  const pane = el('div', 'pane');
  const tab = {
    id: `tab-${state.seq++}`,
    type: 'query',
    connId: conn.id,
    database,
    title: `Query · ${database || conn.name}`,
    pane,
    result: null,
  };

  const editorWrap = el('div', 'editor-wrap');
  const ta = el('textarea', 'sql');
  ta.spellcheck = false;
  ta.value = initialSql || '';
  ta.placeholder = 'SELECT * FROM ... ;   (Ctrl+Enter để chạy)';
  editorWrap.appendChild(ta);
  pane.appendChild(editorWrap);

  const hsplit = el('div', 'hsplitter');
  pane.appendChild(hsplit);

  const bar = el('div', 'pane-toolbar');
  const btnRun = el('button', 'btn primary', '▶ Chạy');
  btnRun.title = 'Ctrl+Enter';
  const dbLabel = el('label', '', 'Database:');
  const dbSel = el('select', 'input');
  const btnCsv = el('button', 'btn ghost', 'CSV');
  const timing = el('span', '');
  timing.style.cssText = 'margin-left:auto;color:var(--text-dim);font-size:12px';
  bar.append(btnRun, el('div', 'tb-sep'), dbLabel, dbSel, el('div', 'tb-sep'), btnCsv, timing);
  pane.appendChild(bar);

  const body = el('div', 'grid-wrap');
  pane.appendChild(body);

  function fillDatabases() {
    const st = state.nodes[conn.id];
    const list = (st && st.databases) || (database ? [database] : []);
    dbSel.textContent = '';
    const none = el('option', '', '(không chọn)');
    none.value = '';
    dbSel.appendChild(none);
    for (const d of list) {
      const o = el('option', '', d);
      o.value = d;
      if (d === tab.database) o.selected = true;
      dbSel.appendChild(o);
    }
  }
  fillDatabases();
  dbSel.onchange = () => {
    tab.database = dbSel.value;
    tab.title = `Query · ${tab.database || conn.name}`;
    renderTabs();
  };

  function selectedSql() {
    const s = ta.selectionStart;
    const e = ta.selectionEnd;
    const sql = (s !== e ? ta.value.slice(s, e) : ta.value).trim();
    return sql.replace(/;\s*$/, '');
  }

  async function run() {
    const sql = selectedSql();
    if (!sql) { status('Chưa có câu lệnh nào', true); return; }
    body.textContent = '';
    body.appendChild(el('div', 'msg', 'Đang chạy…'));
    btnRun.disabled = true;
    try {
      const r = unwrap(await api.db.query(conn.id, tab.database, sql));
      body.textContent = '';
      if (r.kind === 'rows') {
        tab.result = r;
        renderGrid(body, r, { offset: 0 });
        timing.textContent = `${fmtNum(r.rows.length)} dòng · ${r.elapsed} ms`;
        status(`Trả về ${fmtNum(r.rows.length)} dòng trong ${r.elapsed} ms`);
      } else {
        tab.result = null;
        const parts = [`OK — ${fmtNum(r.affectedRows)} dòng bị ảnh hưởng`];
        if (r.insertId && r.insertId !== '0') parts.push(`insertId = ${r.insertId}`);
        if (r.info) parts.push(r.info);
        body.appendChild(el('div', 'msg ok', `${parts.join('\n')}\n${r.elapsed} ms`));
        timing.textContent = `${r.elapsed} ms`;
        status(parts[0]);
        refreshTreeIfDdl(sql);
      }
    } catch (e) {
      body.textContent = '';
      body.appendChild(el('div', 'msg error', errText(e)));
      timing.textContent = '';
      status(errText(e), true);
    } finally {
      btnRun.disabled = false;
    }
  }

  function refreshTreeIfDdl(sql) {
    if (/^\s*(create|drop|alter|rename|truncate)\b/i.test(sql) && tab.database) {
      refreshDb(conn, tab.database);
    }
  }

  btnRun.onclick = run;
  btnCsv.onclick = () => exportCsv('query.csv', tab.result);
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); run(); }
    if (e.key === 'Tab') {
      e.preventDefault();
      const s = ta.selectionStart;
      ta.setRangeText('  ', s, ta.selectionEnd, 'end');
    }
  });
  tab.onFocus = () => { fillDatabases(); ta.focus(); };
  tab.onRefresh = run;

  // kéo để đổi chiều cao editor
  hsplit.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = ta.offsetHeight;
    const move = (ev) => { ta.style.height = `${Math.max(60, startH + ev.clientY - startY)}px`; };
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });

  addTab(tab);
  ta.focus();
  return tab;
}

/* ------------------------------------------------------------ sidebar */

(() => {
  const sidebar = $('#sidebar');
  $('#splitter').addEventListener('mousedown', (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebar.offsetWidth;
    const move = (ev) => { sidebar.style.width = `${Math.min(520, Math.max(160, startW + ev.clientX - startX))}px`; };
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });
})();

/* ---------------------------------------------------------- shortcuts */

function currentConnAndDb() {
  const active = state.tabs.find((t) => t.id === state.activeTabId);
  if (active) return { conn: state.connections.find((c) => c.id === active.connId), database: active.database };
  const key = state.selectedKey || '';
  const [kind, connId, db] = key.split(':');
  if (kind === 'd' || kind === 't') {
    return { conn: state.connections.find((c) => c.id === connId), database: db };
  }
  if (kind === 'c') return { conn: state.connections.find((c) => c.id === connId), database: '' };
  return { conn: state.connections[0], database: '' };
}

api.onMenu('menu:new-connection', () => openConnDialog(null));
api.onMenu('menu:close-tab', () => { if (state.activeTabId) closeTab(state.activeTabId); });
api.onMenu('menu:new-query', () => {
  const { conn, database } = currentConnAndDb();
  if (!conn) { status('Hãy tạo một kết nối trước', true); return; }
  openQueryTab(conn, database || '');
});
api.onMenu('menu:refresh', () => {
  const active = state.tabs.find((t) => t.id === state.activeTabId);
  if (active && active.onRefresh) active.onRefresh();
});

/* --------------------------------------------------------------- boot */

reloadConnections().then(() => {
  if (state.connections.length === 0) openConnDialog(null);
});

/* Hook gỡ lỗi: chỉ dùng từ DevTools (Ctrl+Shift+I). */
window.__tableu = { state, reloadConnections, toggleConn, toggleDb, openDataTab, openQueryTab, renderTree };

})();
