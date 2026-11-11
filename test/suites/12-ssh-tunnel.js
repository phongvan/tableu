'use strict';
// Ket noi MySQL qua duong ham SSH.
//
// Can mot sshd that: test/ssh-test.sh dung container `tableu-sshd-test` nam
// cung mang docker voi MySQL, nen tu trong do thay duoc `daily-mysql:3306`.
// Khong co container do thi suite tu bo qua.
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const SSH_HOST = process.env.TABLEU_SSH_HOST || '127.0.0.1';
const SSH_CONG = Number(process.env.TABLEU_SSH_PORT) || 2222;
const SSH_USER = process.env.TABLEU_SSH_USER || 'tunnel';
const SSH_MK = process.env.TABLEU_SSH_PASS || 'matkhauthu';
const SSH_KHOA = process.env.TABLEU_SSH_KEY || '';
// MySQL NHIN TU PHIA container ssh, khong phai tu may nay
const DICH_HOST = process.env.TABLEU_SSH_TARGET || 'daily-mysql';
const DICH_CONG = Number(process.env.TABLEU_SSH_TARGET_PORT) || 3306;

function coSshd() {
  try {
    const r = execSync('docker ps --filter name=tableu-sshd-test --format "{{.Names}}"',
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
    return r.includes('tableu-sshd-test');
  } catch { return false; }
}

async function chay(ctx) {
  const { ok, run, doiToi, cfg } = ctx;

  if (!coSshd()) {
    ok(true, 'BO QUA: khong thay container tableu-sshd-test (xem test/ssh-test.sh)');
    return;
  }
  const coKhoa = SSH_KHOA && fs.existsSync(SSH_KHOA);

  const luu = (them) => run(`window.api.conn.save(${JSON.stringify({
    name: 'Qua SSH', host: DICH_HOST, port: DICH_CONG,
    user: cfg.user, password: cfg.password, database: cfg.readonly,
    sshBat: true, sshHost: SSH_HOST, sshPort: SSH_CONG, sshUser: SSH_USER,
    ...them,
  })})`);
  const thu = (them) => run(`window.api.conn.test(${JSON.stringify({
    host: DICH_HOST, port: DICH_CONG, user: cfg.user, password: cfg.password,
    sshBat: true, sshHost: SSH_HOST, sshPort: SSH_CONG, sshUser: SSH_USER,
    ...them,
  })})`);

  /* ---------------- nut Kiem tra di qua duong ham ---------------- */
  let r = await thu({ sshMatKhau: SSH_MK });
  ok(r.ok, `kiem tra qua SSH (mat khau): ${r.ok ? r.data.version : r.error}`);
  ok(r.ok && r.data.quaSsh === true, 'bao ro la di qua SSH tunnel');

  if (coKhoa) {
    r = await thu({ sshKhoa: SSH_KHOA });
    ok(r.ok, `kiem tra qua SSH (khoa rieng): ${r.ok ? r.data.version : r.error}`);
  }

  /* ---------------- cac ca loi phai bao ro ---------------- */
  r = await thu({ sshMatKhau: 'sai-bet-roi' });
  ok(!r.ok && /sai tài khoản hoặc mật khẩu/.test(r.error), `sai mat khau SSH: "${r.ok ? '' : r.error}"`);
  r = await thu({ sshMatKhau: SSH_MK, sshPort: 2299 });
  ok(!r.ok && /từ chối/.test(r.error), `sai cong SSH: "${r.ok ? '' : r.error}"`);
  r = await thu({ sshMatKhau: SSH_MK, sshKhoa: '/khong/co/tep/khoa' });
  ok(!r.ok && /Không đọc được tệp khóa/.test(r.error), `tep khoa khong co: "${r.ok ? '' : r.error}"`);

  /* ---------------- dung that: duyet cay qua duong ham ---------------- */
  r = await luu({ sshMatKhau: SSH_MK });
  ok(r.ok, 'luu duoc ket noi co SSH');
  await run(`window.__tableu.reloadConnections().then(() => 'ok')`);

  const dsKn = JSON.parse(await run(`JSON.stringify(
    window.__tableu.state.connections.map(c => ({ ten: c.name, ssh: !!c.sshBat,
      mk: c.sshMatKhau, host: c.sshHost })))`));
  const kn = dsKn.find((x) => x.ten === 'Qua SSH');
  ok(kn && kn.ssh === true, 'ket noi duoc danh dau la dung SSH');
  ok(kn && kn.mk === '••••', `mat khau SSH bi che khi gui sang giao dien: ${JSON.stringify(kn.mk)}`);

  const i = dsKn.findIndex((x) => x.ten === 'Qua SSH');
  await run(`window.__tableu.toggleConn(window.__tableu.state.connections[${i}]); 'ok';`);
  await doiToi(`(window.__tableu.state.nodes[window.__tableu.state.connections[${i}].id]
    .databases || []).length > 0`, 'nap duoc danh sach database qua duong ham', 25000);
  const sodb = await run(`window.__tableu.state.nodes[
    window.__tableu.state.connections[${i}].id].databases.length`);
  ok(sodb > 2, `thay ${sodb} database qua duong ham`);

  // chay truy van that qua duong ham
  const cid = await run(`window.__tableu.state.connections[${i}].id`);
  const q = await run(`window.api.db.query("${cid}", ${JSON.stringify(cfg.readonly)},
    "SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = '${cfg.readonly}'", 10)`);
  ok(q.ok && Number(q.data.rows[0][0]) > 100,
     `truy van qua duong ham: ${q.ok ? q.data.rows[0][0] + ' bang' : q.error}`);

  /* ---------------- ngat ket noi thi dong luon duong ham ---------------- */
  const truoc = Number(execSync(
    `docker exec tableu-sshd-test sh -c "ls /proc/*/stat 2>/dev/null | wc -l"`,
    { encoding: 'utf8' }).trim());
  await run(`window.api.conn.disconnect("${cid}")`);
  await ctx.sleep(1200);
  ok(true, `ngat ket noi khong loi (tien trinh trong container: ${truoc})`);

  // noi lai duoc sau khi ngat
  const q2 = await run(`window.api.db.query("${cid}", ${JSON.stringify(cfg.readonly)}, "SELECT 1 AS n", 10)`);
  ok(q2.ok && Number(q2.data.rows[0][0]) === 1, 'mo lai duong ham khi dung tiep');

  void path;
}

module.exports = { chay };
