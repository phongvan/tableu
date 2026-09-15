'use strict';
// Gioi han so dong cua tab truy van.
// Suite nay sinh ra tu mot bug that: `SELECT * FROM daily` (161.608 dong x 54 cot)
// lam treo cung cua so, phai giet tien trinh.
const { moKetNoi, moTabTruyVan, chaySql } = require('../tien-ich');

async function chay(ctx) {
  const { ok, cfg } = ctx;
  await moKetNoi(ctx, '');
  await moTabTruyVan(ctx, cfg.readonly);

  let r = await chaySql(ctx, 'SELECT * FROM daily');
  ok(r.dong === 1000, `bang 161k dong -> ve 1.000 dong mac dinh (thuc te ${r.dong})`);
  ok(/cắt ở/.test(r.canhBao || ''), 'hien canh bao da bi cat');
  ok(!ctx.win.isDestroyed() && !ctx.wc.isCrashed(), 'cua so con song');

  r = await chaySql(ctx, 'SELECT * FROM daily', 200);
  ok(r.dong === 200, `ton trong lua chon 200 dong (thuc te ${r.dong})`);

  r = await chaySql(ctx, 'SELECT * FROM approval_requests', 1000);
  ok(r.dong === 96 && !r.canhBao, `ket qua nho khong bi cat, khong canh bao (${r.dong} dong)`);

  // Chot chan thu hai tinh theo SO O, khong theo so dong
  r = await chaySql(ctx, 'SELECT s.* FROM setting2 s, approval_requests a, categories c', 1000);
  const tran = Math.floor(120000 / 453);
  ok(r.cot === 453, `bang rong: ${r.cot} cot`);
  ok(r.dong > 0 && r.dong <= tran, `chi ve ${r.dong} dong (tran ${tran} o ${453} cot)`);
  ok(/Chỉ vẽ/.test(r.canhBao || ''), 'canh bao ve thieu vi qua nhieu cot');

  // Sau khi doi sang stream, cac duong khac phai con nguyen
  r = await chaySql(ctx, 'SET @x := 1', 200);
  ok(/OK/.test(r.status), `cau lenh khong tra ve bang: "${r.status.slice(0, 40)}"`);
  r = await chaySql(ctx, 'SELEC sai cu phap', 200);
  ok(/syntax/i.test(r.status), 'loi cu phap van bao dung');
  r = await chaySql(ctx, 'SELECT 1 AS a', 200);
  ok(r.dong === 1, 'connection van dung duoc sau khi bi cat va sau loi');
}

module.exports = { chay };
