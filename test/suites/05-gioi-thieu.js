'use strict';
// Hop thoai Gioi thieu: noi dung lay tu package.json, khong ghi cung.

async function chay(ctx) {
  const { ok, run, doiToi } = ctx;
  const pkg = require('../../package.json');

  // --- kenh app:info ---
  const t = await run(`window.api.appInfo()`);
  ok(t.ok, 'kenh app:info tra ve duoc');
  ok(t.data.ten === 'TableU', `ten app = "${t.data.ten}" (khong phai "tableu" viet thuong)`);
  ok(t.data.phienBan === pkg.version, `phien ban = ${t.data.phienBan}, khop package.json`);
  ok(t.data.tacGia === pkg.author.name, `tac gia = "${t.data.tacGia}"`);
  ok(t.data.email === pkg.author.email, `email = "${t.data.email}"`);
  ok(t.data.giayPhep === pkg.license, `giay phep = ${t.data.giayPhep}`);

  // --- mo hop thoai ---
  ok(!(await run(`document.querySelector('#about-dialog').open`)), 'ban dau hop thoai dong');
  await run(`window.__tableu.moGioiThieu()`);
  await doiToi(`document.querySelector('#about-dialog').open`, 'hop thoai mo ra');

  const noiDung = await run(`(() => {
    const g = (id) => (document.querySelector(id) || {}).textContent;
    const d = document.querySelector('#about-dialog');
    return { ten: g('#about-ten'), ver: g('#about-phien-ban'), moTa: g('#about-mo-ta'),
             tacGia: g('#about-tac-gia'), email: g('#about-email'), giayPhep: g('#about-giay-phep'),
             rong: Math.round(d.getBoundingClientRect().width) }; })()`);
  ok(noiDung.tacGia === pkg.author.name, `hien tac gia: "${noiDung.tacGia}"`);
  ok(noiDung.email === pkg.author.email, `hien email: "${noiDung.email}"`);
  ok(noiDung.ver === `v${pkg.version}`, `hien phien ban: "${noiDung.ver}"`);
  ok(noiDung.giayPhep === 'MIT', `hien giay phep: "${noiDung.giayPhep}"`);
  ok(noiDung.moTa.length > 10, `hien mo ta: "${noiDung.moTa.slice(0, 40)}…"`);
  ok(noiDung.rong > 300 && noiDung.rong < 520, `hop thoai rong ${noiDung.rong}px`);

  // --- nut Dong ---
  await run(`document.querySelector('#about-dong').click()`);
  await doiToi(`!document.querySelector('#about-dialog').open`, 'nut Dong dong hop thoai');
  ok(true, 'nut Dong hoat dong');

  // --- mo lai nhieu lan khong nhan doi ---
  await run(`window.__tableu.moGioiThieu()`);
  await doiToi(`document.querySelector('#about-dialog').open`, 'mo lai lan hai');
  await run(`window.__tableu.moGioiThieu()`);   // goi khi dang mo, khong duoc nem loi
  ok(await run(`document.querySelector('#about-dialog').open`), 'goi lai luc dang mo van an toan');
  await run(`document.querySelector('#about-dong').click()`);

  // --- chan giao thuc cua openExternal ---
  const xau = await run(`window.api.moLienKet('file:///etc/passwd')`);
  ok(!xau.ok && /giao thức/i.test(xau.error), `chan file:// -> "${xau.error}"`);
  const xau2 = await run(`window.api.moLienKet('khong-phai-url')`);
  ok(!xau2.ok, `chan chuoi khong phai URL -> "${xau2.error}"`);
}

module.exports = { chay };
