# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

TableU — ứng dụng Electron xem bảng và chạy truy vấn MySQL, nhắm riêng Linux/Ubuntu.
Renderer là DOM thuần, **không framework, không bundler, không bước build** — sửa file là chạy được ngay.

## Lệnh

```bash
npm install
npm start              # chạy app
npm run dev            # chạy kèm --enable-logging

npm run pack           # chỉ giải nén ra dist/linux-unpacked
npm run dist:deb       # pack + scripts/build-deb.sh
npm run dist:appimage
npm run dist           # cả hai gói
```

`start`/`dev` cố tình đặt `ELECTRON_RUN_AS_NODE=` ở đầu lệnh. Nếu bỏ đi, app sẽ chết với
`TypeError: Cannot read properties of undefined (reading 'whenReady')` khi khởi chạy từ một
terminal nằm trong Electron (terminal của VS Code, Claude Code) vì biến đó được kế thừa và
biến `require('electron')` thành một chuỗi đường dẫn. Khi tự gọi binary trong tool call, dùng
`env -u ELECTRON_RUN_AS_NODE -u ELECTRON_NO_ATTACH_CONSOLE ./node_modules/.bin/electron .`

## Kiểm thử

```bash
npm test              # tất cả suite
npm test 02           # chỉ suite có "02" trong tên
```

`test/run.js` dựng lại database nháp rồi chạy từng suite trong một tiến trình Electron riêng
(`test/harness.js`). Harness mở cửa sổ thật, nạp `main.js` thật, rồi lái renderer qua
`executeJavaScript`. Suite là module trong `test/suites/` xuất một hàm `chay(ctx)`.

`ctx` có: `run(js)` chạy JS trong renderer, `ok(điều_kiện, mô_tả)` ghi nhận một phép kiểm,
`doiToi(biểu_thức, mô_tả)` chờ tới khi biểu thức đúng, `sleep`, `cfg`, `win`, `wc`.
Tiện ích mở kết nối / mở tab nằm trong `test/tien-ich.js`.

Harness **tự động báo hỏng** khi renderer ghi ra lỗi console, khi tiến trình renderer chết,
hoặc khi cửa sổ treo — kể cả khi mọi `ok()` đều đạt. Cần thế, vì lỗi cú pháp trong renderer
giết cả `app.js` mà main process không hề báo gì.

Cấu hình MySQL đọc từ biến môi trường, mặc định trỏ vào Docker của máy này:
`TABLEU_TEST_HOST` (mặc định `127.0.1.1`), `_PORT`, `_USER`, `_PASS`, `_DB`, `_RO_DB`.

### Ba cái bẫy khi viết test cho dự án này

- **Đừng `sleep` một mốc cố định, hãy `doiToi`.** `.tabbar` có `scroll-behavior: smooth` và
  `luuO()` vẽ lạc quan — cả hai đều làm mốc thời gian cố định nhấp nháy.
- **Chờ đúng thứ cần chờ.** `loadData()` khi đang tải cũng đặt một `<div class="msg">`, nên chờ
  `.msg` sẽ trả về lúc chưa có dữ liệu; phải chờ `tab.result`. Sau khi sửa ô, chờ chữ trong ô
  là chưa đủ vì `luuO()` vẽ giá trị mới **trước** khi server xác nhận — phải chờ lớp
  `cell-saving` tan.
- **Kiểm tra giá trị thật, đừng kiểm tra "có hay không".** Đã ba lần một phép kiểm dạng
  `length > 0` báo đạt trong khi tính năng sai (gợi ý trả về tên bảng thay vì tên cột vì con trỏ
  đặt lệch một ký tự; `offsetLeft` sai gốc toạ độ). In số/chuỗi thật rồi so khớp chính xác.

## Kiến trúc

Ba lớp, ranh giới rõ ràng:

| Lớp | Vai trò |
|---|---|
| `main.js` | Toàn bộ truy cập MySQL. Pool `mysql2`, handler IPC, lưu kết nối, hộp thoại lưu file |
| `preload.js` | `contextBridge` phơi `window.api`. `contextIsolation` bật, `nodeIntegration` tắt |
| `renderer/app.js` | Toàn bộ UI. Không chạm Node, mọi thứ đi qua `window.api` |

**Hợp đồng IPC.** Mọi handler bọc trong `handle()` và luôn trả `{ok: true, data}` hoặc
`{ok: false, error}` — không bao giờ ném lỗi qua IPC. Renderer gọi `unwrap()` để bung ra hoặc
ném `Error`. Thêm kênh mới thì phải đi qua `handle()` để giữ nguyên hợp đồng này.

**Pool** được cache trong `Map` với khoá `${connId}::${database}`. Sửa hoặc xoá một kết nối sẽ
gọi `closePoolsFor(connId)` để dọn mọi pool của nó.

**Hình dạng kết quả truy vấn.** Mọi câu SELECT chạy với `rowsAsArray: true`, rồi `shapeResult()`
trả về `{columns: [{name, table, kind, pk, unsigned}], rows: [[...]]}`:

- Dòng là **mảng, không phải object** — bắt buộc, vì JOIN có thể sinh trùng tên cột.
- `kind` do `colKind()` suy ra từ mã `columnType` của MySQL (`num`/`time`/`text`/`json`/`bool`/
  `enum`/`blob`). Renderer đổ thẳng thành class CSS `k-${kind}` để tô màu — màu theo kiểu dữ
  liệu là **lấy từ metadata**, không phải đoán bằng regex trên giá trị. Thêm kiểu mới thì phải
  sửa cả `colKind()`, `KIND_LABEL` trong `app.js`, và khối `table.grid td.k-*` trong CSS.
- `cell()` chuyển Buffer thành `{blob, bytes}` và cắt chuỗi quá `MAX_CELL`.

**Sửa ô trên lưới.** Chỉ tab dữ liệu mới sửa được, tab truy vấn thì không (không suy ra
được bảng nguồn từ một câu SELECT bất kỳ). Luồng:

1. `db:rows` trả kèm `keys` (mảng giá trị khoá chính của từng dòng, **lấy thẳng từ MySQL, không
   phải từ ô hiển thị** — `cell()` cắt chuỗi dài và đổi Buffer thành object nên dùng lại sẽ
   định sai dòng) và `meta` (`pk`, `nullable`, `generated`, `suaDuoc`, `lyDo`).
2. Renderer gửi lại `keys[rowIndex]` khi ghi. **Tên cột khoá thì server tự đọc ra** bằng
   `tableMeta()` — client chỉ gửi giá trị. Đừng bao giờ để client quyết định mệnh đề WHERE:
   một lỗi phía renderer sẽ thành `UPDATE` quét cả bảng. `pkWhere()` là chốt chặn đó.
3. `db:updateCell` chạy `UPDATE ... WHERE <pk> = ? LIMIT 1` tham số hoá, rồi **đọc lại nguyên
   dòng** trả về. Bắt buộc phải đọc lại: `ON UPDATE CURRENT_TIMESTAMP`, trigger và cột
   `STORED GENERATED` đều làm đổi những ô khác, không đọc lại thì lưới hiện số cũ.
4. `luuO()` thay cả dòng trong `result.rows` rồi gọi `fillRow()` dựng lại các `<td>`.

Hệ quả của bước 4: **mọi tham chiếu `<td>` lấy trước khi lưu đều thành rác sau khi lưu.**
Chuyển ô bằng `Tab` phải `await` xong rồi mới tìm lại ô kế tiếp — đây từng là bug thật.

`NULL` và chuỗi rỗng là hai thứ khác nhau. Ô soạn thảo để trống nghĩa là chuỗi rỗng; muốn
`NULL` phải chọn "Đặt NULL" trong menu chuột phải, và chỉ hiện với cột `nullable`.

Sự kiện của lưới dùng **uỷ quyền ở cấp `<table>`** (`attachEditing`), không gắn cho từng ô —
một lưới 1000×54 là 54.000 ô.

**Soạn thảo SQL.** Tab truy vấn dùng CodeMirror 5 nạp từ `renderer/vendor/codemirror/` bằng
thẻ `<script>` thường trong `index.html` — **thứ tự nạp quan trọng**, core trước rồi mode rồi
addon, và tất cả phải trước `app.js`. Vendor lại bằng `scripts/vendor-codemirror.sh`.

**Đừng nâng lên CodeMirror 6**: nó là ESM nhiều gói, sẽ buộc phải thêm bundler và phá mất
tính chất không-có-bước-build của dự án. CodeMirror 5 là UMD một file nên hợp với CSP `'self'`.

Theme CodeMirror tên `tableu`, định nghĩa trong `styles.css` và **lấy màu từ biến CSS**, nên nó
tự đổi theo sáng/tối mà không cần gọi `setOption('theme')` — đừng thêm lại cơ chế đổi theme.

Gợi ý do addon `sql-hint` lo; nó nhận `hintOptions.tables` dạng `{tênBảng: [cột...]}`. Lưu ý
sql-hint trả về **tên đầy đủ** `bảng.cột` chứ không phải tên cột trần — kiểm thử phải so đúng
dạng đó.

Có **hai editor với hai phạm vi gợi ý khác nhau**:

| | Tab truy vấn | Ô lọc WHERE (tab dữ liệu) |
|---|---|---|
| Nguồn | kênh `db:schema`, cache trong `schemaCache` theo `${connId}::${database}` | `r.columns` của kết quả vừa vẽ, không tốn truy vấn thêm |
| Phạm vi | mọi bảng trong database | đúng một bảng đang mở |
| Từ khóa SQL | có | không (`disableKeywords: true`) |
| Tên bảng | có | không — lọc bỏ bằng `hintChiCot()` |

`hintChiCot()` cần thiết vì `defaultTable` buộc bảng đó phải nằm trong `tables`, mà khi đã nằm
trong đó thì sql-hint cũng đem tên bảng ra gợi ý. Nó bọc `CodeMirror.hint.sql` rồi lọc lại.

Ô lọc là CodeMirror một dòng (`theme: 'tableu tableu-inline'`, `scrollbarStyle: 'null'`), có
`beforeChange` gộp mọi xuống dòng thành dấu cách, và `Enter` được ánh xạ sang nút Lọc.

**Tab.** `state.tabs` giữ các object `{id, type: 'data'|'query', connId, database, pane, ...}`;
mỗi tab tự sở hữu DOM pane của nó và có thể có `onFocus` / `onRefresh`. `renderTabs()` dựng lại
toàn bộ thanh tab mỗi lần gọi.

## Bẫy đã gặp

Những chỗ này từng tốn thời gian, đừng giẫm lại:

- **`renderer/app.js` phải nằm trọn trong IIFE.** Khai báo `const api = ...` ở phạm vi
  top-level sẽ đụng biến toàn cục mà `contextBridge` tạo ra → `SyntaxError: Identifier 'api'
  has already been declared` → cả file không chạy, và main process không báo gì cả.
- **Độ ưu tiên CSS trong lưới.** `table.grid td` (2 element + 1 class) thắng `td.k-num`
  (1 element + 1 class). Mọi ghi đè cho ô phải viết đủ `table.grid td.k-...`.
- **Trong `.tabbar` đừng dùng `offsetLeft`.** `.tabbar` không có `position`, nên `offsetParent`
  là `<body>` và toạ độ lệch đúng bằng bề rộng sidebar. Dùng `getBoundingClientRect()`.
- **Thanh tab ẩn scrollbar** (`scrollbar-width: none`), nên cuộn ngang hoàn toàn dựa vào
  listener `wheel` tự viết — Chromium không tự quy `deltaY` thành cuộn ngang. Listener có
  chuẩn hoá `deltaMode` (pixel/dòng/trang); giữ nguyên phần đó.
- **CSP trong `renderer/index.html` chặn mọi thứ từ bên ngoài** (`default-src 'none'`). Không
  CDN, không font từ Google. Muốn thêm thư viện thì phải để file vào `renderer/`.
- **Định danh luôn đi qua `mysql.escapeId()`.** Riêng ô `WHERE` ở tab dữ liệu được ghép thẳng
  vào SQL — **cố ý**, để người dùng viết điều kiện tự do như Navicat, không phải lỗ hổng cần vá.
- `multipleStatements: false`. Tab truy vấn chạy một câu mỗi lần; bôi đen để chọn câu cần chạy.
- **Tab truy vấn phải có hai tầng chặn, đừng bỏ tầng nào.** `db:query` đọc kết quả bằng
  stream rồi `destroy()` khi đủ `maxRows`; renderer còn cắt thêm theo **số ô** (`MAX_O_LUOI`)
  vì 1.000 dòng của bảng 453 cột vẫn là 453.000 thẻ `<td>`. Bỏ một trong hai là
  `SELECT * FROM <bảng lớn>` treo cứng cửa sổ — đã từng xảy ra.
- **`.tabbar` có `scroll-behavior: smooth`**, nên sau khi đổi vị trí cuộn phải đợi animation
  xong mới đo được. Test dùng `sleep` cố định rất dễ nhấp nháy — hãy chờ tới khi giá trị
  ổn định thay vì chờ một mốc thời gian.

## Đóng gói

- **`.deb` do [scripts/build-deb.sh](scripts/build-deb.sh) dựng bằng `dpkg-deb`**, không phải
  electron-builder. electron-builder gọi `fpm`, mà `fpm` cần lệnh `ar` trong gói `binutils` —
  máy này chưa cài. `build.linux.target` trong `package.json` vì thế chỉ còn AppImage.
  Script tự viết `postinst` đặt `chrome-sandbox` thành setuid root.
- **AppImage chạy thẳng bị crash trên máy này** (`GPU process isn't usable`). Sandbox của
  Chromium không exec được chính nó qua mount FUSE. Chạy bằng `--appimage-extract-and-run`
  (giữ sandbox) hoặc `--no-sandbox` (tắt sandbox). Bản `.deb` không dính lỗi này.
- `build.electronLanguages` chỉ giữ `en-US` và `vi`; mặc định Electron kèm 55 tệp ngôn ngữ
  chiếm 40 MB.
- `dist/` và `download/` nằm trong `.gitignore`. File cài đã nén sẵn bên trong nên nén lại
  vô ích (đo được: `zstd -19` còn 100%, `xz -9e` còn 99.4%) — phát hành qua GitHub Releases.

## Quy ước

Chuỗi hiển thị viết tiếng Việt có dấu đầy đủ. Comment trong mã phần lớn là tiếng Việt không
dấu — viết theo kiểu xung quanh. Comment chỉ dùng để giải thích **vì sao**, thường là ghi lại
một cái bẫy ở trên; đừng thêm comment mô tả lại điều mà mã đã nói rõ.
