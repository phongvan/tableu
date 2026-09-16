'use strict';
// Doc tep .sql va chay tung cau lenh.
//
// Vi sao tu tach cau lenh thay vi bat multipleStatements: mot ban dump 68MB
// khong the nhet vao mot query (max_allowed_packet), va khi loi thi can biet
// cau lenh thu may hong. Tach bang tokenizer chu khong split(';') — dau cham
// phay nam trong chuoi, trong chu thich, va trong than TRIGGER/PROCEDURE.
const fs = require('node:fs');

function taoBoTach() {
  let dl = ';';          // delimiter hien tai
  let trong = null;      // "'" | '"' | '`' khi dang trong chuoi/dinh danh
  let thoat = false;     // ky tu truoc la dau \ trong chuoi
  let cmt = null;        // 'dong' | 'khoi'
  let giuKhoi = false;   // /*! ... */ la chu thich MySQL thuc thi duoc, phai giu
  let manh = [];         // cac manh cua cau lenh dang gom (join mot lan o cuoi)
  let coNoiDung = false; // cau hien tai da co ky tu khac khoang trang chua
  let du = '';           // phan chua du thong tin de quyet dinh

  // Gom bang mang roi join: noi chuoi tung ky tu cho 20MB la qua cham.
  const them = (t) => {
    manh.push(t);
    if (!coNoiDung && /\S/.test(t)) coNoiDung = true;
  };
  const layCau = () => {
    const t = manh.join('').trim();
    manh = [];
    coNoiDung = false;
    return t;
  };

  // `cuoi` = da het tep, khong con cho them du lieu nua
  function nap(text, cuoi) {
    const ra = [];
    const s = du + text;
    du = '';
    // Chua het tep thi phai chua lai mot doan duoi: cac mau can nhin xa hon
    // mot ky tu — "--x" va "/*!" can 3, "DELIMITER " can 10, va delimiter
    // tuy bien co the dai bao nhieu cung duoc. Chi giu 1 ky tu la sai ngay
    // tai ranh gioi chunk.
    const giuLai = cuoi ? 0 : Math.max(12, dl.length);
    const han = s.length - giuLai;
    let i = 0;

    while (i < han) {
      const c = s[i];
      const c2 = s[i + 1];

      if (cmt === 'dong') {
        if (c === '\n') { cmt = null; them(c); }
        i++; continue;
      }
      if (cmt === 'khoi') {
        if (giuKhoi) them(c);
        if (c === '*' && c2 === '/') {
          if (giuKhoi) them('/');
          cmt = null; giuKhoi = false; i += 2; continue;
        }
        i++; continue;
      }
      if (trong) {
        them(c);
        if (thoat) { thoat = false; i++; continue; }
        if (c === '\\' && trong !== '`') { thoat = true; i++; continue; }
        if (c === trong) {
          // '' va "" la cach viet lap de thoat dau nhay
          if (c2 === trong) { them(c2); i += 2; continue; }
          trong = null;
        }
        i++; continue;
      }

      // ---- ngoai chuoi va ngoai chu thich ----
      if (c === '-' && c2 === '-' && (s[i + 2] === undefined || /\s/.test(s[i + 2]))) {
        cmt = 'dong'; i += 2; continue;
      }
      if (c === '#') { cmt = 'dong'; i++; continue; }
      if (c === '/' && c2 === '*') {
        giuKhoi = s[i + 2] === '!';
        if (giuKhoi) them('/*');
        cmt = 'khoi'; i += 2; continue;
      }
      if (c === "'" || c === '"' || c === '`') { trong = c; them(c); i++; continue; }

      // DELIMITER la lenh cua client, khong gui xuong server.
      // Chan truoc bang `coNoiDung` va ky tu dau: truoc day cho goi
      // cau.trim() moi ky tu, voi cau dai 800KB thi thanh O(n^2) va treo.
      if (!coNoiDung && (c === 'd' || c === 'D')
          && /^delimiter[ \t]/i.test(s.slice(i, i + 11))) {
        const hetDong = s.indexOf('\n', i);
        if (hetDong === -1 && !cuoi) break;   // doi them du lieu; phan con lai do cuoi ham gom
        const dong = s.slice(i, hetDong === -1 ? s.length : hetDong);
        const moi = dong.slice(9).trim();
        if (moi) dl = moi;
        manh = [];
        coNoiDung = false;
        i = hetDong === -1 ? s.length : hetDong + 1;
        continue;
      }

      if (c === dl[0] && s.startsWith(dl, i)) {
        const t = layCau();
        if (t) ra.push(t);
        i += dl.length;
        continue;
      }

      them(c);
      i++;
    }

    if (!cuoi && i < s.length) du += s.slice(i);
    if (cuoi) {
      const t = layCau();
      if (t) ra.push(t);
    }
    return ra;
  }

  return { nap, delimiter: () => dl };
}

/* ---------------------------------------------------------------- chinh */

// Doc tep theo luong, chay tung cau lenh tren MOT connection giu suot qua trinh
// (de bien phien, DELIMITER, LOCK TABLES deu con hieu luc).
async function nhap(pool, { duongDan, boQuaLoi = false, tienDo }) {
  const tongByte = fs.statSync(duongDan).size;
  const conn = await pool.getConnection();
  const tach = taoBoTach();

  let soCau = 0;
  let soLoi = 0;
  const loi = [];
  let daDoc = 0;

  const chay = async (danhSach) => {
    for (const cau of danhSach) {
      soCau++;
      try {
        await conn.query(cau);
      } catch (e) {
        soLoi++;
        if (loi.length < 20) {
          loi.push({ thuTu: soCau, loi: e.message, cau: cau.slice(0, 200) });
        }
        if (!boQuaLoi) {
          const err = new Error(`Câu lệnh #${soCau} lỗi: ${e.message}`);
          err.chiTiet = { thuTu: soCau, cau: cau.slice(0, 400) };
          throw err;
        }
      }
      if (tienDo && soCau % 200 === 0) tienDo(daDoc, tongByte, soCau);
    }
  };

  try {
    await conn.query('SET FOREIGN_KEY_CHECKS=0');
    await new Promise((resolve, reject) => {
      const doc = fs.createReadStream(duongDan, { encoding: 'utf8', highWaterMark: 1 << 20 });
      let day = Promise.resolve();
      doc.on('data', (chunk) => {
        daDoc += Buffer.byteLength(chunk, 'utf8');
        doc.pause();
        day = day
          .then(() => chay(tach.nap(chunk, false)))
          .then(() => doc.resume())
          .catch(reject);
      });
      doc.on('error', reject);
      doc.on('end', () => {
        day.then(() => chay(tach.nap('', true))).then(resolve).catch(reject);
      });
    });
    await conn.query('SET FOREIGN_KEY_CHECKS=1');
  } finally {
    conn.release();
  }

  if (tienDo) tienDo(tongByte, tongByte, soCau);
  return { soCau, soLoi, loi };
}

module.exports = { nhap, taoBoTach };
