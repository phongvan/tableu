'use strict';
// Ctrl+F: tim trong PHAN DANG HIEN THI cua luoi, giong Ctrl+F cua trinh duyet.
const { moKetNoi, moTabDuLieu } = require('../tien-ich');

// Kiem bang display THUC TE, khong phai thuoc tinh .hidden: `.find-bar` tung
// dat `display: flex` nen `hidden = true` khong giau duoc gi, ma phep kiem
// dua vao `.hidden` van bao dat.
const HIEN = `getComputedStyle(document.querySelector('#find-bar')).display !== 'none'`;
const DEM = `document.querySelector('#find-dem').textContent`;
const SO_MARK = `document.querySelectorAll('.pane.active mark.tim-thay').length`;
const CHON = `document.querySelectorAll('.pane.active mark.tim-thay.dang-chon').length`;

const phim = (k, opt = {}) => `(() => { window.dispatchEvent(new KeyboardEvent('keydown',
  Object.assign({ key: ${JSON.stringify(k)}, bubbles: true, cancelable: true }, ${JSON.stringify(opt)})));
  return 'ok'; })()`;

const go = (t) => `(() => { const i = document.querySelector('#find-input');
  i.value = ${JSON.stringify(t)};
  i.dispatchEvent(new Event('input', { bubbles: true })); return 'ok'; })()`;

async function chay(ctx) {
  const { ok, run, doiToi, cfg } = ctx;
  const db = cfg.playground;
  await moKetNoi(ctx, db);
  await moTabDuLieu(ctx, db, 'nguoi_dung');

  /* ---------------- mo / dong ---------------- */
  ok(!(await run(HIEN)), 'ban dau thanh tim KHONG hien tren man hinh');
  await run(phim('f', { ctrlKey: true }));
  await doiToi(HIEN, 'Ctrl+F lam thanh tim hien ra');
  ok(await run(`document.activeElement.id === 'find-input'`), 'con tro vao thang o nhap');

  /* ---------------- tim thay ---------------- */
  await run(go('an'));
  await doiToi(`${SO_MARK} > 0`, 'co ket qua duoc to sang');
  let m = await run(SO_MARK);
  ok(m === 2, `go "an" -> ${m} cho khop (An, an@x.com)`);
  ok(await run(CHON) === 1, 'dung mot ket qua dang duoc chon');
  ok(/^1\/2$/.test(await run(DEM)), `bo dem hien "${await run(DEM)}"`);

  /* ---------------- khong phan biet hoa thuong ---------------- */
  await run(go('AN'));
  await doiToi(`${SO_MARK} === 2`, 'chu hoa van khop');
  ok(true, 'tim khong phan biet hoa thuong');

  /* ---------------- nhay giua cac ket qua ---------------- */
  await run(phim('Enter'));   // su kien window khong toi o nhap; dung nut
  await run(`document.querySelector('#find-sau').click(); 'ok';`);
  await doiToi(`${DEM} === '2/2'`, 'bam xuong sang ket qua 2');
  ok(true, `nut xuong: ${await run(DEM)}`);
  await run(`document.querySelector('#find-sau').click(); 'ok';`);
  await doiToi(`${DEM} === '1/2'`, 'qua ket qua cuoi thi quay vong ve dau');
  ok(true, 'di qua cuoi thi vong lai dau');
  await run(`document.querySelector('#find-truoc').click(); 'ok';`);
  await doiToi(`${DEM} === '2/2'`, 'nut len lui mot ket qua');
  ok(true, 'nut len chay dung');

  /* ---------------- khong thay ---------------- */
  await run(go('khongcogiday123'));
  await doiToi(`${DEM}.includes('không thấy')`, 'bao khong thay');
  ok(await run(SO_MARK) === 0, 'khong to sang gi khi khong khop');

  /* ---------------- KHONG duoc quet cay ben trai ---------------- */
  // Go ten mot bang: neu tim ca sidebar thi se khop o cay, sai pham vi.
  await run(go('nguoi_dung'));
  await ctx.sleep(300);
  ok(await run(`document.querySelectorAll('#tree mark').length`) === 0,
     'cay ben trai khong bi to sang');

  /* ---------------- cot so thu tu bi loai tru ---------------- */
  await run(go('1'));
  await ctx.sleep(300);
  ok(await run(`document.querySelectorAll('.pane.active td.rownum mark').length`) === 0,
     'cot # khong bi tinh la ket qua');

  /* ---------------- o NULL giu nguyen dinh dang sau khi dong ---------------- */
  const nullTruoc = await run(`document.querySelectorAll('.pane.active td .null').length`);
  ok(nullTruoc > 0, `truoc khi tim co ${nullTruoc} o NULL`);
  await run(go('null'));
  await ctx.sleep(300);
  ok(await run(SO_MARK) > 0, 'tim duoc chu NULL');
  await run(`document.querySelector('#find-dong').click(); 'ok';`);
  await doiToi(`!(${HIEN})`, 'nut X lam thanh tim bien mat khoi man hinh');
  const nullSau = await run(`document.querySelectorAll('.pane.active td .null').length`);
  ok(nullSau === nullTruoc,
     `dong tim xong o NULL van con dinh dang (${nullTruoc} -> ${nullSau})`);
  ok(await run(SO_MARK) === 0, 'go sach moi <mark> khi dong');

  /* ---------------- Escape dong ---------------- */
  await run(phim('f', { ctrlKey: true }));
  await doiToi(HIEN, 'mo lai');
  await run(phim('Escape'));
  await doiToi(`!(${HIEN})`, 'Escape lam thanh tim bien mat');
  ok(true, 'Escape dong duoc');

  /* ---------------- doi tab thi dong lai ---------------- */
  await run(phim('f', { ctrlKey: true }));
  await run(go('an'));
  await doiToi(`${SO_MARK} > 0`, 'co ket qua truoc khi doi tab');
  await moTabDuLieu(ctx, db, 'khoa_ghep');
  ok(!(await run(HIEN)), 'doi tab thi thanh tim bien mat (ket qua thuoc luoi cu)');
  ok(await run(`document.querySelectorAll('mark.tim-thay').length`) === 0,
     'khong con <mark> sot lai o bat ky dau');

  /* ---------------- luoi ve lai thi tu tim lai ---------------- */
  await moTabDuLieu(ctx, db, 'nguoi_dung');
  await run(phim('f', { ctrlKey: true }));
  await run(go('an'));
  await doiToi(`${SO_MARK} === 2`, 'co ket qua');
  // doi so dong moi trang -> luoi dung lai
  await run(`(() => { const sel = document.querySelectorAll('.pane.active select.input')[0];
    sel.value = '500'; sel.dispatchEvent(new Event('change')); })(); 'ok';`);
  await doiToi(`${SO_MARK} === 2`, 'sau khi luoi ve lai, ket qua duoc tim lai');
  ok(true, 'doi trang/sap xep xong van giu ket qua tim');
}

module.exports = { chay };
