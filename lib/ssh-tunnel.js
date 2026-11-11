'use strict';
// Mo mot duong ham SSH roi lang nghe o 127.0.0.1:<cong ngau nhien>. Moi ket
// noi vao cong do duoc day qua SSH toi <dichHost>:<dichCong> ben kia.
//
// Dung ssh2 chu khong goi binary `ssh` cua he thong: can xac thuc bang mat
// khau va passphrase ma khong hoi nguoi dung giua chung, va de con chay duoc
// tren Windows sau nay. ssh2 thuan JS, khong keo theo buoc bien dich nao.
const net = require('node:net');
const fs = require('node:fs');
const { Client } = require('ssh2');

const CHO_SAN_SANG = 15000;

// ssh2 bao loi kha kho hieu; doi sang cau nguoi dung lam duoc gi do.
function loiDeHieu(e, cfg) {
  const m = String((e && e.message) || e);
  if (/All configured authentication methods failed/i.test(m)) {
    return cfg.khoaRiengTu
      ? 'SSH từ chối khóa này. Kiểm tra lại khóa riêng, passphrase, và khóa công khai đã nằm trong authorized_keys chưa.'
      : 'SSH từ chối: sai tài khoản hoặc mật khẩu.';
  }
  if (/ECONNREFUSED/i.test(m)) return `Không kết nối được SSH tới ${cfg.host}:${cfg.port} (bị từ chối).`;
  if (/ENOTFOUND|EAI_AGAIN/i.test(m)) return `Không tìm thấy máy chủ SSH "${cfg.host}".`;
  if (/ETIMEDOUT|Timed out/i.test(m)) return `Hết thời gian chờ khi kết nối SSH tới ${cfg.host}:${cfg.port}.`;
  if (/Cannot parse privateKey|Unsupported key format/i.test(m)) {
    return 'Không đọc được khóa riêng (sai định dạng, hoặc cần passphrase).';
  }
  if (/Encrypted private key detected|bad passphrase|Bad passphrase/i.test(m)) {
    return 'Khóa riêng có passphrase — nhập passphrase vào ô bên dưới.';
  }
  return `Lỗi SSH: ${m}`;
}

function docKhoa(duongDan) {
  try {
    return fs.readFileSync(duongDan);
  } catch (e) {
    throw new Error(`Không đọc được tệp khóa "${duongDan}": ${e.code || e.message}`);
  }
}

/**
 * cfg: { host, port, user, matKhau?, khoaRiengTu?, passphrase?, dichHost, dichCong }
 * onDong: goi khi duong ham dut giua chung (de ben ngoai don pool)
 */
function moTunnel(cfg, onDong) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let xong = false;
    const hong = (e) => {
      if (xong) { if (onDong) onDong(e); return; }
      xong = true;
      try { conn.end(); } catch { /* ignore */ }
      reject(e instanceof Error && /^(SSH|Không|Hết)/.test(e.message) ? e : new Error(loiDeHieu(e, cfg)));
    };

    conn.on('ready', () => {
      const server = net.createServer((sock) => {
        // Mot ket noi hong khong duoc phep giet ca tien trinh
        sock.on('error', () => sock.destroy());
        conn.forwardOut('127.0.0.1', 0, cfg.dichHost, cfg.dichCong, (err, stream) => {
          if (err) { sock.destroy(); return; }
          stream.on('error', () => sock.destroy());
          sock.pipe(stream).pipe(sock);
        });
      });
      server.on('error', hong);
      server.listen(0, '127.0.0.1', () => {
        if (xong) return;
        xong = true;
        resolve({
          cong: server.address().port,
          dong() {
            try { server.close(); } catch { /* ignore */ }
            try { conn.end(); } catch { /* ignore */ }
          },
        });
      });
    });

    conn.on('error', hong);
    conn.on('close', () => { if (xong && onDong) onDong(new Error('Đường hầm SSH đã đóng.')); });

    let khoa;
    if (cfg.khoaRiengTu) khoa = docKhoa(cfg.khoaRiengTu);

    conn.connect({
      host: cfg.host || '127.0.0.1',
      port: Number(cfg.port) || 22,
      username: cfg.user,
      ...(khoa
        ? { privateKey: khoa, passphrase: cfg.passphrase || undefined }
        : { password: cfg.matKhau || '' }),
      readyTimeout: CHO_SAN_SANG,
      keepaliveInterval: 20000,
    });
  });
}

module.exports = { moTunnel };
