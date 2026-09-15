# TODO

## Hỗ trợ Windows

Hoãn lại ngày 2026-09-15. Đã phân tích xong, chưa làm.

**Kết luận: làm được, và mã ứng dụng không phải sửa gì.** Chỉ phải sửa tooling.

Đã kiểm tra codebase, bốn thứ hay giết tính đa nền tảng đều sạch:

- Không có `process.platform` hay nhánh riêng cho Linux trong `main.js`, `preload.js`, `renderer/app.js`
- Không có đường dẫn cứng — tất cả qua `path.join()` và `app.getPath()`
- **Không có module native**: `mysql2` thuần JS, cả 12 gói runtime đều thuần JS.
  Nghĩa là không cần node-gyp, không cần Visual Studio Build Tools
- Phím tắt dùng `CmdOrCtrl` (menu) và `Ctrl-` (CodeMirror), đều đúng trên Windows

### Việc cần làm

| Chỗ | Vấn đề | Hướng sửa |
|---|---|---|
| `scripts.start` / `scripts.dev` trong `package.json` | `ELECTRON_RUN_AS_NODE= electron .` là cú pháp bash, cmd/PowerShell không chạy | dùng `cross-env`, hoặc bỏ tiền tố (nó chỉ cần khi chạy từ terminal nằm trong Electron) |
| `test/run.js` dòng 10 | Trỏ `node_modules/.bin/electron`, trên Windows tệp tên `electron.cmd` → báo nhầm "Chưa có Electron" | lấy đường dẫn từ `require('electron')` thay vì ghép tay |
| `build` trong `package.json` | Chỉ có `build.linux`; `dist:deb` gọi `bash scripts/build-deb.sh` | thêm khối `build.win` (target `nsis` + `portable`) và script `dist:win` |
| `main.js` dòng 98-99 | `chmod 0600` cho `connections.json` **không có tác dụng trên Windows** — mật khẩu mất lớp bảo vệ quyền tệp | ghi rõ trong tài liệu, hoặc dùng DPAPI |
| `--font-mono` trong `renderer/styles.css` | Không có font mono nào của Windows, sẽ rơi xuống Courier New | thêm `Consolas`, `Cascadia Mono` |
| `test/config.js` | Mặc định `127.0.1.1` là thói quen của Debian/Ubuntu | trên Windows phải đặt `TABLEU_TEST_HOST` |

### Lưu ý khi đóng gói

Build artifact Windows **từ máy Linux** khác với chuyện app chạy trên Windows:

- `zip` / `dir`: build thẳng từ Linux được
- `nsis` (bộ cài `.exe`): electron-builder cần **Wine**
- Ký số: cần chứng chỉ, không có thì Windows SmartScreen sẽ cảnh báo người dùng

Sạch nhất là build trên chính Windows, hoặc GitHub Actions với runner `windows-latest`.

### Chưa xác nhận

Phân tích trên **dựa vào đọc mã, chưa từng chạy thử trên Windows**. Những thứ chỉ lộ ra
lúc chạy thật vẫn cần một máy Windows để kiểm: hành vi cửa sổ, DPI scaling, và đường dẫn
`userData` (`%APPDATA%\tableu`).

Ước lượng: 30–60 phút, rủi ro thấp vì `npm test` đã có 60 phép kiểm để soi ngay còn gì hỏng.

---

## Đã đề xuất nhưng chưa làm

Từ roadmap trước đó, xếp theo mức hữu ích hằng ngày:

1. **Xem đầy đủ giá trị một ô** — ô đang bị cắt hai lần: CSS `max-width: 420px` và
   `MAX_CELL` 4096 ký tự trong `main.js`. Cột TEXT/JSON dài không đọc được.
2. **Lịch sử truy vấn** — append vào một tệp JSON trong `userData`.
3. **Tìm trong kết quả + copy bằng bàn phím** — `Ctrl+F` lọc trong lưới, mũi tên di chuyển ô.
4. **Thêm dòng mới** — hiện chỉ sửa và xóa được, chưa thêm.
5. **Chạy nhiều câu lệnh một lượt** — `multipleStatements` đang `false`.
6. **Xuất SQL INSERT / JSON** — hiện chỉ có CSV.
7. **Mật khẩu vào GNOME Keyring** — gói `.deb` đã khai báo phụ thuộc `libsecret-1-0`.

## Việc dọn dẹp còn treo

- Lịch sử git vẫn còn ~116 MB `node_modules` từ commit `abb9ba9` (đã gỡ khỏi chỉ mục ở
  `fc350fa`, nhưng lịch sử thì chưa). Dọn hẳn cần `git filter-repo` + `push --force`.
- `homepage` trong `package.json` còn để tạm `https://example.com/tableu`.
- Bản `.deb` đã cài trên máy là bản cũ ngày 13/09, chưa có sửa ô / CodeMirror / giới hạn dòng.
