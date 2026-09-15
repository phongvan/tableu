# TableU

Trình xem bảng và chạy truy vấn MySQL cho Ubuntu — gọn, chỉ làm đúng việc cần:
xem dữ liệu như Navicat, viết query, xem cấu trúc bảng.

Chạy được vì đây là app Electron thuần (TablePro là app native macOS, không có bản Linux).

## Chạy

```bash
npm install     # chỉ lần đầu
npm start
```

## Kiểm thử

```bash
npm test              # tất cả
npm test 02           # chỉ suite khớp "02"
```

Test mở cửa sổ thật và thao tác như người dùng. Mọi phép ghi chỉ chạy trên database nháp
`tableu_playground` (tự dựng lại trước mỗi lần chạy) — không bao giờ đụng dữ liệu thật.
Đổi máy chủ MySQL bằng `TABLEU_TEST_HOST`, `TABLEU_TEST_PORT`, `TABLEU_TEST_USER`,
`TABLEU_TEST_PASS`.

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
| Tab dữ liệu | Lưới cuộn với header dính, sắp xếp bằng cách bấm tên cột, phân trang 100–1000 dòng, ô `WHERE` tự do, **sửa ô tại chỗ**, xóa dòng, xuất CSV |
| Tab cấu trúc | Danh sách cột (kiểu, NULL, khóa, mặc định, ghi chú) + chỉ mục |
| Tab DDL | `SHOW CREATE TABLE` |
| Tab truy vấn | Soạn SQL **có tô màu cú pháp và gợi ý tên bảng/cột**, `Ctrl+Enter` để chạy, bôi đen để chỉ chạy phần chọn, **giới hạn số dòng trả về**, xuất CSV |
| Khác | Giao diện sáng/tối, menu chuột phải, kéo đổi rộng cây/cao ô soạn thảo |

## Sửa dữ liệu trên lưới

Nhấp đúp vào một ô để sửa.

| Phím | Việc |
|---|---|
| `Enter` | Lưu |
| `Esc` | Hủy, trả lại giá trị cũ |
| `Tab` / `Shift+Tab` | Lưu rồi nhảy sang ô sửa được kế tiếp |

Chuột phải vào ô có thêm: sao chép giá trị, **Đặt NULL**, và xóa dòng.

Vài điểm đáng biết:

- **Ô trống ≠ NULL.** Xóa hết chữ trong ô rồi Enter là lưu chuỗi rỗng. Muốn `NULL` thật thì
  chuột phải → Đặt NULL. Mục này chỉ hiện với cột cho phép NULL.
- **Sau khi lưu, cả dòng được đọc lại từ MySQL.** Nên `updated_at` kiểu
  `ON UPDATE CURRENT_TIMESTAMP`, trigger, hay cột sinh tự động đều hiện ngay giá trị mới
  mà không phải bấm làm mới.
- **Định vị dòng bằng khóa chính**, câu lệnh là `UPDATE ... WHERE <khóa chính> = ? LIMIT 1`
  tham số hóa. Tên cột khóa do phía main process tự đọc từ bảng, giao diện chỉ gửi giá trị.
- Ô sẽ **nháy xanh** khi lưu xong, **nháy đỏ và trả lại giá trị cũ** nếu MySQL từ chối
  (lỗi hiện ở thanh trạng thái dưới cùng).

Không sửa được trong các trường hợp sau, khi đó thanh công cụ hiện huy hiệu `chỉ đọc`:

| Trường hợp | Vì sao |
|---|---|
| View, hoặc bảng không có khóa chính | Không xác định được chính xác dòng nào |
| Cột `STORED`/`VIRTUAL GENERATED` | MySQL không cho UPDATE cột sinh từ biểu thức |
| Cột nhị phân (BLOB) | Chưa hỗ trợ |
| Kết quả ở tab truy vấn | Không suy ra được bảng nguồn từ một câu SELECT bất kỳ |

Chưa có: **thêm dòng mới**, hoàn tác, và sửa nhiều ô rồi lưu một lượt. Mỗi ô lưu ngay khi Enter.

## Soạn SQL

Ô soạn thảo dùng CodeMirror 5: tô màu cú pháp MySQL, số dòng, tự đóng ngoặc, tô ngoặc khớp,
làm nổi dòng đang đứng.

| Phím | Việc |
|---|---|
| `Ctrl+Enter` | Chạy (bôi đen thì chỉ chạy phần chọn) |
| `Ctrl+Space` | Gợi ý tên bảng / cột |
| `Ctrl+/` | Bật tắt chú thích dòng |
| `Tab` | Thụt lề (có bôi đen thì thụt cả khối) |

Gợi ý lấy từ `information_schema` của database đang chọn: gõ vài chữ ra tên bảng, gõ
`tên_bảng.` ra danh sách cột của đúng bảng đó. Danh sách được nhớ theo từng database
(đọc lần đầu mất ~30 ms cho 132 bảng / 1.542 cột) và tự nạp lại khi bạn đổi database.
Gợi ý không bao giờ tự chèn — phải chọn rồi Enter.

### Giới hạn số dòng

Ô **Tối đa** trên thanh công cụ chặn câu lệnh không có `LIMIT` kéo về cả bảng. Mặc định
1.000 dòng. Khi bị cắt, một dải cảnh báo hiện ngay trên lưới.

Cần thiết vì `SELECT * FROM daily` (161.608 dòng × 54 cột) làm **treo cứng cửa sổ** —
phải giết tiến trình. Nay câu đó xong trong khoảng 2 giây. Ngoài giới hạn dòng còn một chốt
chặn theo **số ô** (120.000): 1.000 dòng của bảng 453 cột vẫn là 453.000 ô và vẫn treo, nên
lưới chỉ vẽ số dòng vừa ngưỡng và nói rõ đã vẽ thiếu bao nhiêu.

### Vì sao là CodeMirror 5 chứ không phải 6

CodeMirror 6 là ESM chia thành nhiều gói, dùng nó sẽ **buộc dự án phải thêm bundler** và
mất tính chất "sửa file là chạy ngay". CodeMirror 5 là UMD một file, thả vào `renderer/vendor/`
là xong, và CSP `script-src 'self'` vẫn cho chạy.

Các file lấy từ `node_modules` bằng [scripts/vendor-codemirror.sh](scripts/vendor-codemirror.sh)
và được commit vào repo (~584 KB). Nâng cấp thì `npm i -D codemirror@5` rồi chạy lại script đó.

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
