'use strict';
// CodeMirror: to mau cu phap, goi y ten bang/cot, phim tat.
const { moKetNoi, moTabTruyVan } = require('../tien-ich');

async function chay(ctx) {
  const { ok, run, cfg } = ctx;

  ok(await run(`typeof CodeMirror === 'function'`), 'CodeMirror nap duoc');
  ok(await run(`typeof CodeMirror.hint.sql === 'function'`), 'addon sql-hint nap duoc');
  ok(await run(`!!CodeMirror.modes['sql']`), 'mode sql nap duoc');

  await moKetNoi(ctx, '');
  await moTabTruyVan(ctx, cfg.readonly);
  const cm = `window.__tableu.state.tabs.slice(-1)[0].cm`;

  // --- to mau ---
  await run(`${cm}.setValue('-- chu thich\\nSELECT id FROM t WHERE x = 12')`);
  const tok = await run(`(() => { const P = document.querySelector('.pane.active'); const m = {};
    for (const c of ['cm-keyword','cm-number','cm-comment']) {
      const e = P.querySelector('.CodeMirror .' + c);
      if (e) m[c] = getComputedStyle(e).color;
    } return m; })()`);
  ok(tok['cm-keyword'] && tok['cm-number'] && tok['cm-comment'], 'to mau keyword/number/comment');
  ok(tok['cm-keyword'] !== tok['cm-number'], 'keyword va number khac mau');

  // --- theme doi theo sang/toi ---
  const truoc = tok['cm-keyword'];
  await run(`document.querySelector('#btn-theme').click()`);
  await ctx.sleep(400);
  const sau = await run(`getComputedStyle(document.querySelector('.CodeMirror .cm-keyword')).color`);
  ok(sau !== truoc, `theme doi mau keyword: ${truoc} -> ${sau}`);
  await run(`document.querySelector('#btn-theme').click()`);

  // --- schema da nap vao goi y ---
  await ctx.doiToi(`Object.keys((${cm}.getOption('hintOptions') || {}).tables || {}).length > 0`,
                   'nap xong schema cho goi y');
  const h = await run(`(() => { const t = ${cm}.getOption('hintOptions').tables;
    return { soBang: Object.keys(t).length, soCot: (t['approval_requests'] || []).length }; })()`);
  ok(h.soBang > 100, `${h.soBang} bang trong goi y`);
  ok(h.soCot === 12, `approval_requests co ${h.soCot} cot`);

  // Dat con tro o CUOI dong, dung doan chi so — dat sai mot ky tu la
  // goi y ra tên bảng thay vì tên cột mà phep kiem van "dat".
  const goiY = (text) => run(`(async () => {
    document.querySelectorAll('.CodeMirror-hints').forEach(n => n.remove());
    const c = ${cm}; c.setValue(${JSON.stringify(text)});
    c.setCursor({ line: c.lastLine(), ch: c.getLine(c.lastLine()).length });
    c.showHint({ completeSingle: false });
    await new Promise(r => setTimeout(r, 400));
    return [...document.querySelectorAll('.CodeMirror-hints li')].map(x => x.textContent); })()`);

  let g = await goiY('SELECT * FROM daily_par');
  ok(g.length > 0 && g.every((x) => /daily_par/i.test(x)), `goi y ten bang: ${JSON.stringify(g)}`);

  // sql-hint tra ve ten day du 'bang.cot' chu khong phai ten cot tran
  g = await goiY('SELECT * FROM approval_requests.');
  ok(g.length === 12 && g.includes('approval_requests.approved_at'),
     `sau dau cham -> ${g.length} cot cua dung bang do`);

  g = await goiY('SELECT * FROM approval_requests.appr');
  ok(g.length === 2 && g.every((x) => /^approval_requests\.appr/i.test(x)),
     `loc theo tien to: ${JSON.stringify(g)}`);

  g = await goiY('SELECT * FROM bang_nay_khong_ton_tai.');
  ok(g.length === 0 || !g.some((x) => /approved_at/.test(x)), 'khong bia cot cho bang khong co');

  g = await goiY('SEL');
  ok(g.some((x) => /^SELECT$/i.test(x)), 'goi y tu khoa SQL');

  // --- chi chay phan boi den ---
  await run(`(() => { document.querySelectorAll('.CodeMirror-hints').forEach(n => n.remove());
    const c = ${cm}; c.setValue('SELECT 111 AS a;\\nSELECT 222 AS b;');
    c.setSelection({ line: 1, ch: 0 }, { line: 1, ch: 16 });
    document.querySelector('#status').textContent = '';
    c.getOption('extraKeys')['Ctrl-Enter'](c); })()`);
  await ctx.doiToi(`document.querySelector('#status').textContent.length > 0`, 'chay xong');
  const o = await run(`(document.querySelector('.pane.active tbody td:not(.rownum)') || {}).textContent`);
  ok(o === '222', `boi den chi chay phan duoc chon (ra ${o})`);
}

module.exports = { chay };
