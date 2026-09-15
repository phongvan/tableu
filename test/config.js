'use strict';
// Cau hinh MySQL cho test. Doi bang bien moi truong khi may khac.
// Luu y: tren may dev nay cong 3307 co the bi container khac chiem o
// 127.0.0.1, nen mac dinh dung 127.0.1.1 (van ra daily-mysql).
module.exports = {
  host: process.env.TABLEU_TEST_HOST || '127.0.1.1',
  port: Number(process.env.TABLEU_TEST_PORT) || 3307,
  user: process.env.TABLEU_TEST_USER || 'root',
  password: process.env.TABLEU_TEST_PASS || 'root123',
  // DB nhap cho moi phep ghi. KHONG BAO GIO ghi vao DB that.
  playground: process.env.TABLEU_TEST_DB || 'tableu_playground',
  // DB chi doc, dung cho cac phep thu can du lieu lon
  readonly: process.env.TABLEU_TEST_RO_DB || 'daily_dev',
};
