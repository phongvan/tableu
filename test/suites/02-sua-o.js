'use strict';
// Sua du lieu ngay tren luoi. Chi chay tren DB nhap.
const { moKetNoi, moTabDuLieu } = require('../tien-ich');

const O = (r, ten) => `(() => { const P = document.querySelector('.pane.active');
  const ci = [...P.querySelectorAll('table.grid thead th')]
    .findIndex(t => t.textContent.startsWith(${JSON.stringify(ten)})) - 1;
  return P.querySelector('tbody tr[data-r="${r}"] td[data-c="' + ci + '"]'); })()`;

async function chay(ctx) {
  const { ok, run, doiToi, cfg } = ctx;
  const db = cfg.playground;
  await moKetNoi(ctx, db);
  await moTabDuLieu(ctx, db, 'nguoi_dung');

  // --- metadata ---
  const meta = await run(`window.__tableu.state.tabs.slice(-1)[0].result.meta`);
  ok(meta.suaDuoc === true && meta.pk[0] === 'id', `sua duoc, pk = ${JSON.stringify(meta.pk)}`);
  ok(meta.nullable.includes('email') && !meta.nullable.includes('ten'),
     'biet cot nao cho phep NULL');

  // --- nhap doi mo o soan thao ---
  await run(`${O(0, 'ten')}.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
  const v = await run(`(${O(0, 'ten')}.querySelector('input') || {}).value`);
  ok(v === 'An', `nhap doi mo o soan thao, gia tri "${v}"`);

  // --- Escape huy ---
  await run(`(() => { const i = ${O(0, 'ten')}.querySelector('input'); i.value = 'KHONG LUU';
    i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); })()`);
  await doiToi(`!${O(0, 'ten')}.querySelector('input')`, 'o soan thao dong lai');
  ok(await run(`${O(0, 'ten')}.textContent`) === 'An', 'Escape huy, giu gia tri cu');

  // --- Enter luu ---
  await run(`(() => { const td = ${O(0, 'ten')};
    td.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const i = td.querySelector('input'); i.value = 'An Da Sua';
    i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
  // luuO ve gia tri moi NGAY roi moi doi server, nen chi cho chu trong o la
  // chua du — phai doi lop 'cell-saving' tan thi ghi moi that su xong.
  await doiToi(`${O(0, 'ten')}.textContent === 'An Da Sua'
    && !${O(0, 'ten')}.classList.contains('cell-saving')`, 'luu xong hoan toan');
  ok(true, 'Enter luu va lam moi o');

  const trongDb = await run(`(async () => { const s = window.__tableu.state;
    const r = await window.api.db.query(s.connections[0].id, ${JSON.stringify(db)},
      "SELECT ten FROM nguoi_dung WHERE id = 1");
    return r.ok ? r.data.rows[0][0] : r.error; })()`);
  ok(trongDb === 'An Da Sua', `ghi xuong DB that: "${trongDb}"`);

  // updated_at phai tu doi vi server doc lai ca dong
  const upd = await run(`${O(0, 'updated_at')}.textContent`);
  ok(/\d{4}-\d{2}-\d{2}/.test(upd), `updated_at tu lam moi tren luoi: ${upd}`);

  // --- Tab nhay sang o ke tiep (tung la bug: fillRow dung lai <td> sau khi luu) ---
  await run(`(() => { const td = ${O(1, 'ten')};
    td.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const i = td.querySelector('input'); i.value = 'Binh2';
    i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })); })()`);
  await doiToi(`!!document.querySelector('.pane.active tbody tr[data-r="1"] td input')`,
               'Tab mo o ke tiep');
  ok(await run(`${O(1, 'ten')}.textContent`) === 'Binh2', 'Tab luu o hien tai roi moi nhay');
  await run(`(() => { const i = document.querySelector('.pane.active td input');
    if (i) i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); })()`);

  // --- cac ca phai bi chan ---
  const goi = (m, ...a) => run(`window.api.db.${m}(window.__tableu.state.connections[0].id,
    ${JSON.stringify(db)}, ${a.map((x) => JSON.stringify(x)).join(',')})`);

  let e = await goi('updateCell', 'co_cot_sinh', [1], 'thanh_tien', '999');
  ok(!e.ok && /sinh tự động/.test(e.error), `chan cot sinh tu dong: "${e.error}"`);
  e = await goi('updateCell', 'khong_co_pk', [1], 'y', 'z');
  ok(!e.ok && /khóa chính/.test(e.error), 'chan bang khong co khoa chinh');
  e = await goi('updateCell', 'nguoi_dung', [999999], 'ten', 'x');
  ok(!e.ok && /Không khớp dòng nào/.test(e.error), 'chan dong khong ton tai');
  e = await goi('updateCell', 'nguoi_dung', [1], 'khong_co_cot_nay', 'x');
  ok(!e.ok && /Không có cột/.test(e.error), 'chan cot khong ton tai');
  e = await goi('updateCell', 'nguoi_dung', [], 'ten', 'x');
  ok(!e.ok && /Thiếu giá trị khóa/.test(e.error), 'chan khi thieu khoa chinh');
  e = await goi('updateCell', 'nguoi_dung', [1], 'ten', null);
  ok(!e.ok, 'chan NULL vao cot NOT NULL');

  // --- NULL khac chuoi rong ---
  let n = await goi('updateCell', 'nguoi_dung', [1], 'email', null);
  const iMail = await run(`window.__tableu.state.tabs.slice(-1)[0]
    .result.columns.findIndex(c => c.name === 'email')`);
  ok(n.ok && n.data.row[iMail] === null, 'dat NULL cho ra NULL that');
  n = await goi('updateCell', 'nguoi_dung', [1], 'email', '');
  ok(n.ok && n.data.row[iMail] === '', 'chuoi rong khac NULL');

  // --- khoa ghep ---
  const kg = await goi('rows', 'khoa_ghep', { limit: 5, offset: 0 });
  ok(kg.data.meta.pk.length === 2, `khoa ghep: ${JSON.stringify(kg.data.meta.pk)}`);
  const iGt = kg.data.columns.findIndex((c) => c.name === 'gia_tri');
  const s2 = await goi('updateCell', 'khoa_ghep', kg.data.keys[1], 'gia_tri', 'da sua');
  ok(s2.ok && s2.data.row[iGt] === 'da sua', 'sua dung dong voi khoa ghep');
  const lai = await goi('rows', 'khoa_ghep', { limit: 5, offset: 0 });
  ok(lai.data.rows[0][iGt] === 'mot mot', 'dong khoa ghep con lai khong bi dung toi');

  // --- xoa dong ---
  const x = await goi('deleteRow', 'nguoi_dung', [3]);
  ok(x.ok && x.data.affectedRows === 1, 'xoa duoc mot dong');
  const x2 = await goi('deleteRow', 'nguoi_dung', [3]);
  ok(!x2.ok, 'xoa lai dong da xoa thi bi chan');

  // --- view va bang khong PK deu chi doc ---
  await moTabDuLieu(ctx, db, 'v_nguoi_dung');
  const badge = await run(`(() => { const b = document.querySelector('.pane.active .badge-ro');
    return { hien: !!b && !b.hidden, chu: b && b.textContent }; })()`);
  ok(badge.hien && badge.chu === 'chỉ đọc', 'view hien huy hieu chi doc');
}

module.exports = { chay };
