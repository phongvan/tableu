'use strict';
// `package.json` bat buoc semver ba so — npm va electron-builder deu tu choi
// "1.5". Nen ta giu ba so ben trong va chi rut gon khi HIEN THI:
//   1.5.0  -> "1.5"      (bo .0 thua)
//   1.5.2  -> "1.5.2"    (co patch thi giu nguyen)
//   2.0.0-rc1 -> "2.0-rc1"
//
// Luu y khi doi quy uoc: dpkg coi "1.5" < "1.5.0". Da phat hanh ban ghi
// "1.5.0" roi thi ban "1.5" sau do bi coi la cu hon va apt se khong cho cai de.
function hienThi(v) {
  const m = /^(\d+)\.(\d+)\.0(-[0-9A-Za-z.-]+)?$/.exec(String(v || ''));
  return m ? `${m[1]}.${m[2]}${m[3] || ''}` : String(v || '');
}

module.exports = { hienThi };
