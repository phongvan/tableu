'use strict';
// Tien ich dung chung cho cac suite.
function taoKetNoi(ctx, database) {
  const c = ctx.cfg;
  return `(async () => {
    const d = document.querySelector('#conn-dialog'); if (d.open) d.close();
    await window.api.conn.save({ name:'test', host:${JSON.stringify(c.host)}, port:${c.port},
      user:${JSON.stringify(c.user)}, password:${JSON.stringify(c.password)},
      database:${JSON.stringify(database || '')} });
    await window.__tableu.reloadConnections();
    return window.__tableu.state.connections.length;
  })()`;
}

async function moKetNoi(ctx, database) {
  await ctx.run(taoKetNoi(ctx, database));
  await ctx.run(`window.__tableu.toggleConn(window.__tableu.state.connections[0])`);
  await ctx.doiToi(
    `(window.__tableu.state.nodes[window.__tableu.state.connections[0].id].databases || []).length > 0`,
    'cay nap xong danh sach database',
  );
}

async function moTabDuLieu(ctx, db, bang) {
  await ctx.run(`(() => { const s = window.__tableu.state;
    window.__tableu.openDataTab(s.connections[0], ${JSON.stringify(db)}, ${JSON.stringify(bang)}); })()`);
  // Cho `result`, dung cho `.msg`: luc dang tai loadData cung dat mot
  // <div class="msg">Đang tải…</div>, cho kieu do se tra ve khi chua co du lieu.
  await ctx.doiToi(`(() => { const t = window.__tableu.state.tabs.slice(-1)[0];
    return !!(t && t.result) || !!document.querySelector('.pane.active .msg.error'); })()`,
    `mo tab du lieu ${bang}`);
}

async function moTabTruyVan(ctx, db) {
  await ctx.run(`(() => { const s = window.__tableu.state;
    window.__tableu.openQueryTab(s.connections[0], ${JSON.stringify(db || '')}); })()`);
  await ctx.doiToi(`!!(window.__tableu.state.tabs.slice(-1)[0] || {}).cm`, 'mo tab truy van');
}

// Chay SQL trong tab truy van dang mo, tra ve trang thai luoi sau khi xong.
async function chaySql(ctx, sql, gioiHan) {
  await ctx.run(`(() => {
    const P = document.querySelector('.pane.active');
    ${gioiHan ? `P.querySelectorAll('select.input')[1].value = '${gioiHan}';` : ''}
    window.__tableu.state.tabs.slice(-1)[0].cm.setValue(${JSON.stringify(sql)});
    document.querySelector('#status').textContent = '';
    P.querySelector('.btn.primary').click(); })()`);
  await ctx.doiToi(`document.querySelector('#status').textContent.length > 0`, `chay: ${sql.slice(0, 40)}`, 60000);
  return ctx.run(`(() => { const P = document.querySelector('.pane.active');
    return { dong: P.querySelectorAll('table.grid tbody tr').length,
             cot: Math.max(P.querySelectorAll('table.grid thead th').length - 1, 0),
             canhBao: (P.querySelector('.canh-bao') || {}).textContent || null,
             loi: (P.querySelector('.msg.error') || {}).textContent || null,
             status: document.querySelector('#status').textContent }; })()`);
}

module.exports = { moKetNoi, moTabDuLieu, moTabTruyVan, chaySql };
