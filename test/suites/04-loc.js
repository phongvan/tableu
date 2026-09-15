'use strict';
// O loc WHERE: goi y ten cot, va CHI cot cua bang dang mo.
const { moKetNoi, moTabDuLieu } = require('../tien-ich');

const CM = `document.querySelector('.pane.active .where-wrap .CodeMirror').CodeMirror`;

async function chay(ctx) {
  const { ok, run, doiToi, cfg } = ctx;
  const db = cfg.readonly;
  await moKetNoi(ctx, db);
  await moTabDuLieu(ctx, db, 'approval_requests');

  ok(await run(`!!${CM}`), 'o loc la editor CodeMirror');

  // --- pham vi goi y ---
  const h = await run(`(() => { const o = ${CM}.getOption('hintOptions');
    return { bang: Object.keys(o.tables), macDinh: o.defaultTable,
             tatTuKhoa: !!o.disableKeywords,
             soCot: o.tables[o.defaultTable].length }; })()`);
  ok(h.bang.length === 1 && h.bang[0] === 'approval_requests',
     `chi nap dung 1 bang: ${JSON.stringify(h.bang)}`);
  ok(h.macDinh === 'approval_requests' && h.soCot === 12,
     `defaultTable = ${h.macDinh}, ${h.soCot} cot`);
  ok(h.tatTuKhoa, 'da tat goi y tu khoa SQL');

  const goiY = (text) => run(`(async () => {
    document.querySelectorAll('.CodeMirror-hints').forEach(n => n.remove());
    const c = ${CM}; c.setValue(${JSON.stringify(text)});
    c.setCursor({ line: 0, ch: c.getLine(0).length });
    c.showHint({ completeSingle: false });
    await new Promise(r => setTimeout(r, 400));
    return [...document.querySelectorAll('.CodeMirror-hints li')].map(x => x.textContent); })()`);

  let g = await goiY('appr');
  ok(g.length === 2 && g.includes('approved_at') && g.includes('approved_by'),
     `go "appr" -> chi ten cot: ${JSON.stringify(g)}`);

  g = await goiY('status = 1 AND not');
  ok(g.includes('note') && g.length === 1, `goi y giua cau: ${JSON.stringify(g)}`);

  // Diem mau chot cua yeu cau: KHONG duoc goi y bang khac hay cot bang khac.
  g = await goiY('daily');
  ok(g.length === 0, `"daily" la ten bang khac -> khong goi y (${g.length} muc)`);
  g = await goiY('yellow_wall');
  ok(g.length === 0, 'cot cua bang khac cung khong goi y');
  g = await goiY('SEL');
  ok(g.length === 0, 'tu khoa SQL khong lot vao');

  // --- o loc van lam dung viec cu ---
  await run(`(() => { document.querySelectorAll('.CodeMirror-hints').forEach(n => n.remove());
    ${CM}.setValue('status = 1');
    document.querySelectorAll('.pane.active .pane-toolbar .btn')[1].click(); })()`);
  await doiToi(`(window.__tableu.state.tabs.slice(-1)[0].result || {}).total === 8`,
               'ap dung duoc bo loc');
  const t = await run(`window.__tableu.state.tabs.slice(-1)[0].result.total`);
  ok(t === 8, `loc "status = 1" -> ${t} dong`);

  // Enter cung ap dung, va khong duoc xuong dong
  await run(`(() => { const c = ${CM}; c.setValue('status = 0');
    c.getOption('extraKeys').Enter(c); })()`);
  await doiToi(`(window.__tableu.state.tabs.slice(-1)[0].result || {}).total === 88`,
               'Enter ap dung bo loc');
  ok(await run(`${CM}.lineCount()`) === 1, 'o loc luon chi co mot dong');

  // dan van ban nhieu dong thi bi gop lai, khong vo giao dien
  await run(`${CM}.replaceRange('a\\nb\\nc', { line: 0, ch: 0 }, { line: 0, ch: 99 })`);
  ok(await run(`${CM}.lineCount()`) === 1,
     `dan nhieu dong van gop thanh mot: "${await run(`${CM}.getValue()`)}"`);

  // --- doi sang bang khac thi goi y phai doi theo ---
  await moTabDuLieu(ctx, db, 'categories');
  const h2 = await run(`(() => { const o = ${CM}.getOption('hintOptions');
    return { bang: Object.keys(o.tables)[0], soCot: o.tables[Object.keys(o.tables)[0]].length }; })()`);
  ok(h2.bang === 'categories', `sang tab khac -> goi y theo bang "${h2.bang}" (${h2.soCot} cot)`);
}

module.exports = { chay };
