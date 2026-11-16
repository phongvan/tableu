'use strict';
const mysql = require('./mysql');
const postgres = require('./postgres');

const DRIVERS = { mysql, postgres };

function driverCho(loai) {
  const d = DRIVERS[loai || 'mysql'];
  if (!d) throw new Error(`Chưa hỗ trợ loại database "${loai}"`);
  return d;
}

// Danh sach cho hop chon trong giao dien
const danhSach = Object.values(DRIVERS).map((d) => ({
  loai: d.loai, ten: d.ten, congMacDinh: d.congMacDinh,
  nhanCapHai: d.nhanCapHai, canDatabase: !!d.canDatabase,
  hoTroXuatNhap: !!d.hoTroXuatNhap,
}));

module.exports = { driverCho, danhSach };
