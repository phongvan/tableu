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

**Không có test framework, không có test suite.** Cách kiểm chứng đang dùng là viết một script
Electron dùng-một-lần trong thư mục scratchpad, `require` thẳng `main.js` rồi điều khiển renderer:

```js
const { app, BrowserWindow } = require('electron');
app.setPath('userData', `${process.env.OUT}/userdata`);   // đừng đụng cấu hình thật
require('/home/tinhtn/Desktop/tableU/main.js');
app.whenReady().then(async () => {
  const win = BrowserWindow.getAllWindows()[0];
  win.webContents.on('console-message', (_e, l, m) => console.log(`[${l}] ${m}`));
  const run = (js) => win.webContents.executeJavaScript(js, true);
  await run(`window.__tableu.reloadConnections()`);
  // ... thao tác rồi đo bằng getComputedStyle / getBoundingClientRect
  require('fs').writeFileSync('shot.png', (await win.webContents.capturePage()).toPNG());
  app.exit(0);
});
```

Cuối `renderer/app.js` có hook `window.__tableu` (state, reloadConnections, toggleConn,
toggleDb, openDataTab, openQueryTab, renderTree) để script lái được app. Giữ hook này.

Hai điều bắt buộc khi kiểm chứng UI:

- **Luôn gắn `console-message`.** Lỗi cú pháp trong renderer làm chết toàn bộ `app.js` mà main
  process không hề báo gì — nhìn stdout sẽ tưởng app chạy tốt.
- **Đo số thô, đừng trả về boolean.** Một phép đo sai (ví dụ `offsetLeft` sai gốc toạ độ) sẽ
  khiến assertion "PASS" trong khi tính năng vẫn hỏng. In số ra rồi kiểm tra tính nhất quán.

Máy này có sẵn MySQL 8.3 trong Docker (`daily-mysql`, cổng **3307**, `root`/`root123`):

- `daily_dev` — DB **thật** của người dùng, 132 bảng. **Chỉ đọc, tuyệt đối không ghi.**
- `tableu_playground` — DB nháp để test ghi, có sẵn các ca khó: bảng PK thường
  (`nguoi_dung`, có `ON UPDATE CURRENT_TIMESTAMP`), khoá ghép (`khoa_ghep`),
  cột `STORED GENERATED` (`co_cot_sinh.thanh_tien`), bảng không PK (`khong_co_pk`),
  và một view (`v_nguoi_dung`). Mọi test UPDATE/DELETE chạy ở đây.
  Gieo lại bằng `DELETE FROM nguoi_dung` + `ALTER TABLE nguoi_dung AUTO_INCREMENT=1` + INSERT.

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
