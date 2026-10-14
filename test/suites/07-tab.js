'use strict';
// Menu chuot phai tren tab, va nut "+ Query" tren thanh cong cu.
const { moKetNoi, moTabDuLieu } = require('../tien-ich');

const MUC = `[...document.querySelectorAll('#ctx-menu .item')].map(x => x.textContent)`;
const SO_TAB = `window.__tableu.state.tabs.length`;

function chuotPhaiTab(i) {
  return `(() => { const t = document.querySelectorAll('.tab')[${i}];
    t.dispatchEvent(new MouseEvent('contextmenu',
      { bubbles: true, cancelable: true, clientX: 100, clientY: 50 }));
    return ${MUC}.length; })()`;
}
const bamMuc = (chu) => `(() => {
  const m = [...document.querySelectorAll('#ctx-menu .item')]
    .find(x => x.textContent.includes(${JSON.stringify(chu)}));
  if (!m) return 'KHONG THAY: ' + ${JSON.stringify(chu)};
  m.click(); return 'ok'; })()`;

async function chay(ctx) {
  const { ok, run, doiToi, cfg } = ctx;
  const db = cfg.playground;
  await moKetNoi(ctx, db);

  /* ---------------- nut + Query ---------------- */
  ok(await run(`!!document.querySelector('#btn-new-query')`), 'co nut + Query tren thanh cong cu');
  ok(await run(`document.querySelector('#btn-new-query').title.includes('Ctrl+T')`),
     'nut co goi y phim tat Ctrl+T');

  await run(`document.querySelector('#btn-new-query').click(); 'ok';`);
  await doiToi(`${SO_TAB} === 1`, 'nut + Query mo duoc tab');
  const loai = await run(`window.__tableu.state.tabs[0].type`);
  ok(loai === 'query', `tab tao ra la tab truy van (${loai})`);
  ok(await run(`!!window.__tableu.state.tabs[0].cm`), 'tab co editor CodeMirror');

  // bam nhieu lan thi ra nhieu tab, giong Ctrl+T
  await run(`document.querySelector('#btn-new-query').click(); 'ok';`);
  await doiToi(`${SO_TAB} === 2`, 'bam lan hai ra tab thu hai');
  ok(true, 'bam nhieu lan mo nhieu tab, khong dung lai tab cu');

  /* ---------------- mo them vai tab du lieu ---------------- */
  await moTabDuLieu(ctx, db, 'nguoi_dung');
  await moTabDuLieu(ctx, db, 'co_cot_sinh');
  await moTabDuLieu(ctx, db, 'khoa_ghep');
  ok(await run(SO_TAB) === 5, `dang mo ${await run(SO_TAB)} tab`);

  /* ---------------- menu chuot phai ---------------- */
  const so = await run(chuotPhaiTab(0));
  ok(so === 3, `chuot phai vao tab hien ${so} muc`);
  const muc = await run(`JSON.stringify(${MUC})`);
  const ds = JSON.parse(muc);
  ok(ds[0] === 'Đóng tab này', `muc 1: "${ds[0]}"`);
  ok(ds[1] === 'Đóng các tab khác (4)', `muc 2 co dem dung: "${ds[1]}"`);
  ok(ds[2] === 'Đóng tất cả tab (5)', `muc 3 co dem dung: "${ds[2]}"`);

  /* ---------------- đóng các tab khác ---------------- */
  // chuot phai vao tab thu 3, giu lai dung no
  const giuTen = await run(`document.querySelectorAll('.tab')[2]
    .querySelector('.tab-label').textContent`);
  await run(chuotPhaiTab(2));
  ok(await run(bamMuc('Đóng các tab khác')) === 'ok', 'bam "Đóng các tab khác"');
  await doiToi(`${SO_TAB} === 1`, 'chi con mot tab');
  const conLai = await run(`document.querySelector('.tab .tab-label').textContent`);
  ok(conLai === giuTen, `giu dung tab duoc bam chuot phai ("${conLai}")`);
  ok(await run(`window.__tableu.state.activeTabId === window.__tableu.state.tabs[0].id`),
     'tab con lai tro thanh tab dang chon');
  ok(await run(`document.querySelectorAll('.pane.active').length`) === 1,
     'dung mot pane dang hien');

  /* ---------------- chi con mot tab thi khong hien muc "tab khác" ---------------- */
  await run(chuotPhaiTab(0));
  const ds2 = JSON.parse(await run(`JSON.stringify(${MUC})`));
  ok(ds2.length === 2 && !ds2.some((x) => x.includes('tab khác')),
     `con mot tab thi an muc "tab khác": ${JSON.stringify(ds2)}`);

  /* ---------------- đóng tất cả ---------------- */
  // Dung bang KHAC voi tab dang giu: openDataTab tai dung tab da mo cho cung
  // mot bang, nen mo lai 'nguoi_dung' se khong tao them tab.
  await moTabDuLieu(ctx, db, 'co_cot_sinh');
  await moTabDuLieu(ctx, db, 'khong_co_pk');
  ok(await run(SO_TAB) === 3, `mo lai thanh ${await run(SO_TAB)} tab`);

  // tien the kiem luon hanh vi tai dung tab
  await moTabDuLieu(ctx, db, 'co_cot_sinh');
  ok(await run(SO_TAB) === 3, 'mo lai bang da co thi quay ve tab cu, khong tao tab moi');

  await run(chuotPhaiTab(1));
  ok(await run(bamMuc('Đóng tất cả tab')) === 'ok', 'bam "Đóng tất cả tab"');
  await doiToi(`${SO_TAB} === 0`, 'khong con tab nao');
  ok(await run(`window.__tableu.state.activeTabId === null`), 'khong con tab dang chon');
  ok(await run(`document.querySelectorAll('#panes .pane').length`) === 0,
     'moi pane deu bi go khoi DOM, khong de lai rac');
  ok(await run(`getComputedStyle(document.querySelector('#empty-state')).display !== 'none'`),
     'hien lai man hinh trong');
  ok(await run(`getComputedStyle(document.querySelector('#tabbar')).display === 'none'`),
     'thanh tab tu an khi khong con tab');

  // van mo lai tab moi duoc sau khi dong het
  await run(`document.querySelector('#btn-new-query').click(); 'ok';`);
  await doiToi(`${SO_TAB} === 1`, 'van mo duoc tab moi sau khi dong het');
  ok(true, 'dong het xong van dung binh thuong');
}

module.exports = { chay };
