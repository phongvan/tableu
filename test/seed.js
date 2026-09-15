'use strict';
// Dung lai DB nhap tu dau. Moi suite goi ham nay truoc khi chay.
const mysql = require('mysql2/promise');
const cfg = require('./config');

async function seed() {
  const c = await mysql.createConnection({
    host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password,
    multipleStatements: true, connectTimeout: 8000,
  });
  await c.query(`DROP DATABASE IF EXISTS \`${cfg.playground}\``);
  await c.query(`CREATE DATABASE \`${cfg.playground}\``);
  await c.query(`USE \`${cfg.playground}\`;
    CREATE TABLE nguoi_dung (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      ten VARCHAR(100) NOT NULL,
      email VARCHAR(190) NULL,
      diem DECIMAL(12,2) NOT NULL DEFAULT 0,
      ghi_chu TEXT NULL,
      kich_hoat TINYINT NOT NULL DEFAULT 1,
      created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    );
    CREATE TABLE co_cot_sinh (
      id INT AUTO_INCREMENT PRIMARY KEY,
      gia DECIMAL(10,2) NOT NULL DEFAULT 0,
      sl INT NOT NULL DEFAULT 0,
      thanh_tien DECIMAL(20,2) AS (gia*sl) STORED
    );
    CREATE TABLE khoa_ghep (a INT NOT NULL, b INT NOT NULL, gia_tri VARCHAR(50) NULL, PRIMARY KEY (a,b));
    CREATE TABLE khong_co_pk (x INT, y VARCHAR(20));
    CREATE VIEW v_nguoi_dung AS SELECT id, ten FROM nguoi_dung;`);
  await c.query(`INSERT INTO \`${cfg.playground}\`.nguoi_dung (ten,email,diem,ghi_chu)
    VALUES ('An','an@x.com',10.5,'ghi chu'),('Binh',NULL,0,NULL),('Cuong','c@x.com',99.99,NULL)`);
  await c.query(`INSERT INTO \`${cfg.playground}\`.co_cot_sinh (gia,sl) VALUES (100,3),(250,2)`);
  await c.query(`INSERT INTO \`${cfg.playground}\`.khoa_ghep VALUES (1,1,'mot mot'),(1,2,'mot hai')`);
  await c.query(`INSERT INTO \`${cfg.playground}\`.khong_co_pk VALUES (1,'x'),(2,'y')`);
  await c.end();
}

module.exports = { seed };
