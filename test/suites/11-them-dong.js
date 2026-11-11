'use strict';
// Them dong moi vao bang.
const mysql = require('mysql2/promise');
const { moKetNoi, moTabDuLieu } = require('../tien-ich');

const HOP = `document.querySelector('#themdong-dialog')`;
const o = (ten) => `document.querySelector('#td-cot input[data-cot="${ten}"]')`;
const tickNull = (ten) => `document.querySelector('#td-cot input[data-null-cho="${ten}"]')`;

async function chay(ctx) {
  const { ok, run, doiToi, cfg } = ctx;
  const db = cfg.playground;
  const noi = () => mysql.createConnection({
    host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password, database: db });

  await moKetNoi(ctx, db);
  await moTabDuLieu(ctx, db, 'nguoi_dung');

  /* ---------------- hop thoai dung hinh ---------------- */
  ok(!(await run(`${HOP}.open`)), 'ban dau hop dong');
  await run(`document.querySelector('.pane.active .pane-toolbar .btn[title*="Thêm dòng"]').click(); 'ok';`);
  await doiToi(`${HOP}.open`, 'nut + Dong mo hop thoai');

  const hinh = JSON.parse(await run(`JSON.stringify({
    tieuDe: document.querySelector('#td-title').textContent,
    soO: document.querySelectorAll('#td-cot input.input').length,
    coTickNull: document.querySelectorAll('#td-cot input[type=checkbox]').length,
    goiYid: ${o('id')}.placeholder,
    goiYdiem: ${o('diem')}.placeholder,
    tenBatBuoc: [...document.querySelectorAll('#td-cot .bat-buoc')]
      .map(x => x.parentElement.childNodes[0].textContent) })`));
  ok(/Thêm dòng vào nguoi_dung/.test(hinh.tieuDe), `tieu de: "${hinh.tieuDe}"`);
  ok(hinh.soO === 8, `co du ${hinh.soO} o nhap cho 8 cot`);
  ok(/auto_increment/.test(hinh.goiYid), `cot id ghi ro auto_increment: "${hinh.goiYid}"`);
  ok(/mặc định: 0/.test(hinh.goiYdiem), `cot diem bao mac dinh: "${hinh.goiYdiem}"`);
  ok(hinh.tenBatBuoc.includes('ten'), `danh dau cot bat buoc: ${JSON.stringify(hinh.tenBatBuoc)}`);
  ok(hinh.coTickNull >= 3, `cot cho phep NULL co tick NULL (${hinh.coTickNull} cot)`);

  /* ---------------- them mot dong binh thuong ---------------- */
  await run(`(() => { ${o('ten')}.value = 'Dũng';
    ${o('email')}.value = 'dung@x.com'; ${o('diem')}.value = '7.5'; })(); 'ok';`);
  await run(`document.querySelector('#themdong-form')
    .dispatchEvent(new Event('submit', { cancelable: true, bubbles: true })); 'ok';`);
  await doiToi(`!${HOP}.open`, 'them xong thi hop dong lai');

  let c = await noi();
  let [r] = await c.query("SELECT * FROM nguoi_dung WHERE ten='Dũng'");
  await c.end();
  ok(r.length === 1, 'dong moi co trong DB');
  ok(r[0].email === 'dung@x.com' && String(r[0].diem) === '7.50',
     `gia tri dung: email=${r[0].email}, diem=${r[0].diem}`);
  ok(r[0].id > 0, `auto_increment tu sinh id = ${r[0].id}`);
  ok(r[0].kich_hoat === 1, `cot de trong dung mac dinh (kich_hoat = ${r[0].kich_hoat})`);

  // luoi tu nap lai
  await doiToi(`window.__tableu.state.tabs.slice(-1)[0].result.total === 4`,
               'luoi tu nap lai sau khi them');
  ok(true, 'luoi cap nhat ngay, khong phai bam lam moi');

  /* ---------------- de trong KHAC voi NULL ---------------- */
  await run(`document.querySelector('.pane.active .pane-toolbar .btn[title*="Thêm dòng"]').click(); 'ok';`);
  await doiToi(`${HOP}.open`, 'mo lai hop');
  await run(`(() => { ${o('ten')}.value = 'Tick NULL';
    ${tickNull('email')}.checked = true;
    ${tickNull('email')}.dispatchEvent(new Event('change')); })(); 'ok';`);
  ok(await run(`${o('email')}.disabled`), 'tick NULL thi khoa o nhap lai');
  await run(`document.querySelector('#themdong-form')
    .dispatchEvent(new Event('submit', { cancelable: true, bubbles: true })); 'ok';`);
  await doiToi(`!${HOP}.open`, 'them xong');

  c = await noi();
  [r] = await c.query("SELECT email FROM nguoi_dung WHERE ten='Tick NULL'");
  await c.end();
  ok(r.length === 1 && r[0].email === null, `tick NULL cho ra NULL that (${JSON.stringify(r[0].email)})`);

  /* ---------------- thieu cot bat buoc thi bao loi, khong dong hop ---------------- */
  await run(`document.querySelector('.pane.active .pane-toolbar .btn[title*="Thêm dòng"]').click(); 'ok';`);
  await doiToi(`${HOP}.open`, 'mo lai hop lan ba');
  await run(`document.querySelector('#themdong-form')
    .dispatchEvent(new Event('submit', { cancelable: true, bubbles: true })); 'ok';`);
  // Cho dung lop 'error': luc dang gui, o nay hien "Đang thêm…" cung dai hon 5.
  await doiToi(`document.querySelector('#td-msg').classList.contains('error')`, 'hien loi');
  ok(await run(`${HOP}.open`), 'loi thi hop VAN MO de sua lai, khong mat du lieu da go');
  const loi = await run(`document.querySelector('#td-msg').textContent`);
  ok(/ten/.test(loi), `bao dung cot thieu: "${loi.slice(0, 70)}"`);
  await run(`document.querySelector('#td-huy').click(); 'ok';`);

  /* ---------------- cot sinh tu dong bi khoa ---------------- */
  await moTabDuLieu(ctx, db, 'co_cot_sinh');
  await run(`document.querySelector('.pane.active .pane-toolbar .btn[title*="Thêm dòng"]').click(); 'ok';`);
  await doiToi(`${HOP}.open`, 'mo hop cho bang co cot sinh');
  ok(await run(`${o('thanh_tien')}.disabled`), 'cot STORED GENERATED bi khoa, khong nhap duoc');
  await run(`(() => { ${o('gia')}.value = '50'; ${o('sl')}.value = '4'; })(); 'ok';`);
  await run(`document.querySelector('#themdong-form')
    .dispatchEvent(new Event('submit', { cancelable: true, bubbles: true })); 'ok';`);
  await doiToi(`!${HOP}.open`, 'them duoc dong co cot sinh');
  c = await noi();
  [r] = await c.query('SELECT gia, sl, thanh_tien FROM co_cot_sinh WHERE gia=50 AND sl=4');
  await c.end();
  ok(r.length === 1 && String(r[0].thanh_tien) === '200.00',
     `MySQL tu tinh cot sinh: ${r.length ? r[0].thanh_tien : '?'}`);

  /* ---------------- view thi khong co nut them ---------------- */
  await moTabDuLieu(ctx, db, 'v_nguoi_dung');
  ok(await run(`document.querySelector('.pane.active .pane-toolbar .btn[title*="Thêm dòng"]').hidden`),
     'view: nut + Dong bi an');

  /* ---------------- chan cot bia dat o tang server ---------------- */
  const xau = await run(`window.api.db.insertRow(window.__tableu.state.connections[0].id,
    ${JSON.stringify(db)}, 'nguoi_dung', { khong_co_cot_nay: 'x' })`);
  ok(!xau.ok && /Không có cột/.test(xau.error), `chan cot khong ton tai: "${xau.ok ? '' : xau.error}"`);
  const sinh = await run(`window.api.db.insertRow(window.__tableu.state.connections[0].id,
    ${JSON.stringify(db)}, 'co_cot_sinh', { thanh_tien: '1' })`);
  ok(!sinh.ok && /sinh tự động/.test(sinh.error), `chan dat gia tri cho cot sinh: "${sinh.ok ? '' : sinh.error}"`);
}

module.exports = { chay };
