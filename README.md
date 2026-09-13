# TableU

Trình xem bảng và chạy truy vấn MySQL cho Ubuntu — gọn, chỉ làm đúng việc cần:
xem dữ liệu như Navicat, viết query, xem cấu trúc bảng.

Chạy được vì đây là app Electron thuần (TablePro là app native macOS, không có bản Linux).

## Chạy

```bash
npm install     # chỉ lần đầu
npm start
```

## Đóng gói

```bash
npm run dist            # tạo cả .deb và .AppImage trong dist/
npm run dist:deb        # chỉ .deb
npm run dist:appimage   # chỉ .AppImage
```

Kết quả:

| Tệp | Kích thước |
|---|---|
| `dist/tableu_0.1.0_amd64.deb` | ~75 MB |
| `dist/TableU-0.1.0-x86_64.AppImage` | ~104 MB |

## Cài đặt

**Cách nên dùng — gói `.deb`:**

```bash
sudo apt install ./dist/tableu_0.1.0_amd64.deb
```

Xong là có TableU trong menu ứng dụng, hoặc gõ `tableu` ở terminal.
Gỡ bằng `sudo apt remove tableu`.

Gói cài vào `/opt/TableU`, đặt icon ở `/usr/share/icons/hicolor/512x512/apps/`,
tạo `.desktop` ở `/usr/share/applications/`, và symlink `/usr/bin/tableu`.
Script `postinst` đặt `chrome-sandbox` thành setuid root để **sandbox của Electron
chạy đầy đủ** — đã kiểm chứng bản giải nén khởi động ngon với sandbox bật.

**AppImage** (không cần cài, tiện mang sang máy khác):

```bash
chmod +x dist/TableU-0.1.0-x86_64.AppImage
./dist/TableU-0.1.0-x86_64.AppImage --appimage-extract-and-run
```

Trên máy này, chạy AppImage thẳng (`./TableU-...AppImage`) **bị crash**:
sandbox của Chromium không exec được chính nó qua mount FUSE của AppImage
(`/etc/fuse.conf` không bật `user_allow_other`, nên tiến trình sau khi vào
user namespace mất quyền đọc mount đó). Hai cách chạy được:

- `--appimage-extract-and-run` — giữ nguyên sandbox, đổi lại mỗi lần chạy phải giải nén ra `/tmp`
- `--no-sandbox` — khởi động nhanh nhưng **tắt sandbox renderer**

Vì vậy nên dùng `.deb`; AppImage để dành lúc cần bản chạy-liền.

### Vì sao không dùng `electron-builder` để tạo `.deb`

`electron-builder` gọi `fpm`, mà `fpm` cần lệnh `ar` trong gói `binutils`
(máy này chưa có). [scripts/build-deb.sh](scripts/build-deb.sh) dựng gói bằng
`dpkg-deb` — luôn có sẵn trên Ubuntu, không phải cài thêm gì.
Nếu bạn thích dùng `fpm` thì `sudo apt install binutils` rồi đổi lại
`build.linux.target` trong `package.json`.

Trước khi phát hành cho người khác, sửa `homepage` trong `package.json`
(đang để tạm `https://example.com/tableu`) và `Maintainer` trong
[scripts/build-deb.sh](scripts/build-deb.sh).

## Tính năng

| Khu vực | Có gì |
|---|---|
| Cây bên trái | Nhiều kết nối · database · bảng/view · số dòng ước lượng · ô lọc tên bảng |
| Tab dữ liệu | Lưới cuộn với header dính, sắp xếp bằng cách bấm tên cột, phân trang 100–1000 dòng, ô `WHERE` tự do, xuất CSV |
| Tab cấu trúc | Danh sách cột (kiểu, NULL, khóa, mặc định, ghi chú) + chỉ mục |
| Tab DDL | `SHOW CREATE TABLE` |
| Tab truy vấn | Soạn SQL, `Ctrl+Enter` để chạy, bôi đen để chỉ chạy phần chọn, xuất CSV |
| Khác | Giao diện sáng/tối, menu chuột phải, kéo đổi rộng cây/cao ô soạn thảo |

## Giao diện

- Cỡ chữ nền 14px, lưới dữ liệu 13px mono — đọc thoải mái ở màn hình thường.
- **Ô được tô màu theo kiểu dữ liệu** lấy từ metadata của MySQL, không phải đoán bằng regex:
  số (hổ phách, canh phải), ngày giờ (tím), json (xanh lục), enum (hồng), nhị phân (xám), `NULL` (nghiêng mờ).
- Tên cột có **biểu tượng ⚿ cho khóa chính** và nhãn kiểu dữ liệu ngay bên dưới.
- Chủ đề sáng/tối đầy đủ, đổi bằng nút ◐ góc trên phải, nhớ lựa chọn giữa các lần mở.

## Phím tắt

| Phím | Việc |
|---|---|
| `Ctrl+N` | Kết nối mới |
| `Ctrl+T` | Tab truy vấn mới |
| `Ctrl+W` | Đóng tab |
| `Ctrl+Enter` | Chạy câu lệnh (trong tab truy vấn) |
| `F5` | Làm mới tab hiện tại |
| `Ctrl+Shift+I` | DevTools |

## Cấu trúc mã

| Tệp | Vai trò |
|---|---|
| [main.js](main.js) | Tiến trình chính: cửa sổ, menu, pool `mysql2`, toàn bộ handler IPC |
| [preload.js](preload.js) | Cầu nối `window.api` qua `contextBridge` (contextIsolation bật, nodeIntegration tắt) |
| [renderer/app.js](renderer/app.js) | Toàn bộ giao diện: cây, tab, lưới dữ liệu |
| [renderer/styles.css](renderer/styles.css) | Biến màu cho hai chủ đề sáng/tối |

Renderer không truy cập Node trực tiếp; mọi truy vấn đều đi qua IPC về main process.

## Lưu ý

- **Mật khẩu** lưu dạng văn bản thường trong `~/.config/TableU/connections.json` (quyền `0600`),
  giống cách nhiều DB client làm. Nếu cần an toàn hơn thì nối vào GNOME Keyring (`libsecret`).
- **Ô `WHERE`** được ghép thẳng vào câu SQL — cố ý như vậy để bạn viết điều kiện tự do,
  giống Navicat. Tên bảng và tên cột thì luôn được escape.
- **Nhiều câu lệnh một lần** đang tắt (`multipleStatements: false`). Chạy từng câu, hoặc bôi đen câu cần chạy.
- Lưới **chỉ đọc** — chưa sửa ô trực tiếp. Muốn sửa thì dùng tab truy vấn.
- Đã kiểm thử với MySQL 8.3.

## Muốn mở rộng

- Sửa ô trực tiếp: cần lấy khóa chính từ `db:columns` rồi sinh `UPDATE ... WHERE pk = ?`.
- Tô màu cú pháp SQL: nhúng CodeMirror 6 vào `renderer/` (đừng dùng CDN — CSP đang chặn).
- Thêm PostgreSQL: thay lớp `getPool`/`shapeResult` trong [main.js](main.js) bằng driver tương ứng.
