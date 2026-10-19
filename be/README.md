# LANChat Server

Server Node.js thuần cho hệ thống LAN Chat — **không Electron, không UI**. Chạy bằng `node index.js`.

> **2 rule bắt buộc**
> 1. **Portable, không cài đặt**: cả server là 1 thư mục (giải nén từ zip). Không ghi registry, không cài service.
>    Mọi dữ liệu (DB, file, log, khóa, cấu hình) nằm trong thư mục này: `data/` và `app-config.json` cạnh `index.js`.
> 2. **Máy KHÔNG có internet, chỉ LAN**: server không gọi ra ngoài mạng LAN (không CDN, không telemetry, không kiểm tra cập nhật).

---

## 1. Chạy server

Thư mục sau khi giải nén `LANChat-Server-<version>-win-x64.zip`:

```
LANChat-Server/
├── index.js              ← entry
├── app-config.json       ← cấu hình (tự sinh nếu thiếu)
├── start-server.vbs      ← chạy ẩn (không cửa sổ)
├── start-server.bat      ← chạy có console (xem lỗi / debug)
├── node/node.exe         ← Node.js portable (đi kèm gói)
├── config/ db/ services/ shared/ utils/ http.js ws.js hub.js discovery.js
├── node_modules/         ← better-sqlite3, bcrypt, sharp (win32-x64), ws
└── data/                 ← tự sinh khi chạy lần đầu
```

| Cách | Khi nào |
|---|---|
| Double-click `start-server.vbs` | Dùng hằng ngày: chạy ẩn, không có cửa sổ console. |
| Double-click `start-server.bat` | Lần đầu / khi cần xem lỗi: có console, dừng bằng `Ctrl+C`. |
| `node\node.exe index.js` (CMD trong thư mục server) | Chạy tay. Nếu máy đã cài Node ≥ 22 có thể dùng `node index.js`. |

Cả `.vbs` và `.bat` ưu tiên `node\node.exe`; nếu không có thì dùng Node cài sẵn trên máy.

**Dừng server chạy ẩn**: Task Manager → tab *Details* → `node.exe` → *End task*; hoặc PowerShell:

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*LANChat-Server*index.js*' } | ForEach-Object { Stop-Process -Id $_.ProcessId }
```

(SQLite chạy chế độ WAL nên dừng đột ngột không mất dữ liệu đã ghi.)

**Tự chạy khi bật máy** (không cần cài đặt): `Win + R` → `shell:startup` → tạo shortcut tới `start-server.vbs`.

Khi chạy bằng console, server in địa chỉ LAN, ví dụ `ws://192.168.1.5:5001/ws`. Kiểm tra nhanh: mở trình duyệt `http://<IP-server>:5001/health`.

## 2. Mở Windows Firewall

Chạy **CMD với quyền Administrator** (1 lần).

Trên **máy server**:

```bat
netsh advfirewall firewall add rule name="LANChat Server TCP 5001" dir=in action=allow protocol=TCP localport=5001 profile=private,domain
netsh advfirewall firewall add rule name="LANChat Discovery UDP 41234" dir=in action=allow protocol=UDP localport=41234 profile=private,domain
```

Trên **mọi máy chạy client** (kể cả máy server, vì manager cũng chạy client) — P2P khi server offline:

```bat
netsh advfirewall firewall add rule name="LANChat P2P TCP 5002" dir=in action=allow protocol=TCP localport=5002 profile=private,domain
netsh advfirewall firewall add rule name="LANChat Peer Discovery UDP 5003" dir=in action=allow protocol=UDP localport=5003 profile=private,domain
netsh advfirewall firewall add rule name="LANChat Discovery UDP 41234" dir=in action=allow protocol=UDP localport=41234 profile=private,domain
```

Nếu mạng LAN được Windows nhận là *Public*, đổi `profile=private,domain` thành `profile=any` (hoặc đổi mạng sang Private trong Settings → Network).
Xóa rule: `netsh advfirewall firewall delete rule name="LANChat Server TCP 5001"`.

## 3. Cấu hình — `app-config.json`

Thứ tự ưu tiên: **biến môi trường → `app-config.json` → mặc định** (`config/server.config.js`).
File thiếu → tự sinh với giá trị mặc định. JSON hỏng → server **không** chạy và báo lỗi rõ (không ghi đè file của bạn).

```json
{
  "dataDir": null,
  "server": { "host": "0.0.0.0", "port": 5001, "name": "LANChat Server" },
  "discovery": { "enabled": true, "port": 41234, "intervalMs": 3000 },
  "p2p": { "discoveryPort": 5003, "broadcastEnabled": true },
  "logging": { "level": "info", "consoleLevel": "error", "retentionDays": 30, "logMessageContent": true }
}
```

| Khóa | Ý nghĩa | Env override |
|---|---|---|
| `dataDir` | Thư mục dữ liệu; `null` = `data/` cạnh `index.js`; đường dẫn tương đối tính từ thư mục server | `LANCHAT_DATA_DIR` |
| `server.host` / `server.port` | Địa chỉ + cổng HTTP/WebSocket | `LANCHAT_HOST` / `LANCHAT_PORT` |
| `server.name` | Tên hiển thị trong danh sách server của client | `LANCHAT_SERVER_NAME` |
| `discovery.enabled` / `port` / `intervalMs` | UDP broadcast `server:announce` | `LANCHAT_DISCOVERY_ENABLED` / `LANCHAT_DISCOVERY_PORT` |
| `p2p.discoveryPort` / `broadcastEnabled` | Server broadcast announce lên cổng peer (5003) để client P2P biết server sống lại | `LANCHAT_P2P_DISCOVERY_PORT` / `LANCHAT_P2P_BROADCAST` |
| `logging.level` | Mức tối thiểu ghi file: `debug` < `info` < `warn` < `error` < `audit` (audit luôn ghi) | `LANCHAT_LOG_LEVEL` |
| `logging.consoleLevel` | Mức tối thiểu in ra console (`none` = tắt) | `LANCHAT_LOG_CONSOLE_LEVEL` |
| `logging.retentionDays` | Số ngày giữ log | |
| `logging.logMessageContent` | Mặc định `true`: log **toàn bộ** nội dung tin khi gửi / sửa (kèm nội dung cũ) / thu hồi. `false` → không log nội dung | `LANCHAT_LOG_MESSAGE_CONTENT` |

Các giới hạn khác (upload 200MB, avatar 10MB, bcrypt rounds 10, session 7 ngày, heartbeat 15s...) nằm trong `config/server.config.js`
và có thể override bằng cùng khóa trong `app-config.json` (vd. `"upload": { "maxFileSize": 104857600 }`).

### Trang quản trị: Thành viên + Nhật ký hoạt động (chỉ trên máy chủ)

Trên **chính máy chạy server**, mở trình duyệt (Edge/Chrome) vào `http://localhost:5001/admin`
(đổi 5001 nếu đã sửa `server.port`). Có 2 tab:

- **Thành viên**: mọi tài khoản với vai trò, online/offline, lần đăng nhập gần nhất + IP, số tin / file đã gửi,
  số nhóm, tin gần nhất, ngày tạo; tìm kiếm, xuất Excel. Bấm vào một người → xem toàn bộ nhật ký của người đó.
- **Nhật ký hoạt động**: lọc theo thành viên / nhóm hoạt động (có lựa chọn "Chỉ tin nhắn") / ngày / từ khóa,
  tự làm mới 30 giây, xuất Excel (.csv) và .jsonl.

- Máy khác trong LAN mở `http://<IP-máy-chủ>:5001/admin` → **403**, và lần thử đó được ghi log `admin_page_denied`.
- App chat ở máy nhân viên (kể cả tài khoản manager) **không** có chức năng xem log.
- **Có ghi nội dung tin nhắn** (mặc định): khi gửi, khi sửa (kèm nội dung trước khi sửa) và khi thu hồi (kèm nội dung bị thu hồi —
  DB đã xóa nội dung này, nhật ký là nơi duy nhất còn giữ). Tắt bằng `"logging": { "logMessageContent": false }` trong `app-config.json`.
  **Nên thông báo cho nhân viên** rằng tin nhắn được lưu nhật ký.
- Ghi lại: đăng nhập / đăng nhập sai / đăng xuất, đăng ký, đổi mật khẩu / tên / avatar, gửi / sửa / thu hồi / ghim tin,
  gửi file, tải file về, tạo nhóm, đổi tên nhóm, thêm / duyệt / xóa thành viên, đổi phó nhóm, xóa nhóm, chặn IP, kết nối / ngắt kết nối.

## 4. Thư mục dữ liệu `data/`

```
data/
├── server.db (+ server.db-wal, server.db-shm)   SQLite WAL: users, conversations, messages, files (metadata)...
├── attachments/<sha256>                          file gốc (tên trên đĩa = hash SHA-256, dedup)
├── thumbnails/<sha256>.webp                      thumbnail ảnh ≤ 400px
├── avatars/u<id>-<hash>.webp                     avatar 256×256
├── keys/server-ed25519.pem (+ .pub.pem)          khóa ký session token — GIỮ BÍ MẬT, mất khóa = mọi người phải đăng nhập lại
├── tmp/                                          file tạm khi đang upload (tự dọn khi khởi động)
└── logs/
    ├── server/YYYY-MM-DD.jsonl (-1, -2...)       log server (xoay vòng theo ngày + 10MB, giữ 30 ngày)
    └── clients/YYYY-MM-DD.jsonl                  log do client gửi lên (source:"client", ip + user_id do server xác định)
```

- Không lưu blob trong SQLite; file gốc nằm trong `attachments/`.
- Log dạng JSONL: `{log_id, ts, level, category, user_id, client_id, action, ip?, meta?, source}`. Khóa `password/token/secret/authorization`
  bị thay bằng `[REDACTED]`. Dòng `audit`/`error` đồng thời được ghi vào bảng `audit_log`.
- Người đăng ký **đầu tiên** trên server trở thành `manager` (xem log, chặn IP).

## 5. Sao lưu (backup) và khôi phục

Cần sao lưu: `data/server.db` (+ `-wal`), `data/attachments/`, `data/avatars/`, `data/thumbnails/` (có thể tạo lại), `data/keys/`, `app-config.json`.

**Cách 1 — dừng server rồi copy** (đơn giản, an toàn nhất):

```bat
REM Dừng server trước (Ctrl+C trong console hoặc End task node.exe)
robocopy "D:\LANChat-Server\data" "E:\Backup\LANChat\%DATE:~-4%-%DATE:~3,2%-%DATE:~0,2%" /MIR
```

**Cách 2 — không dừng server**: sao lưu DB bằng SQLite online backup, rồi copy thư mục file:

```bat
cd /d D:\LANChat-Server
node\node.exe -e "require('better-sqlite3')('data/server.db').backup('E:/Backup/LANChat/server.db').then(()=>console.log('OK'))"
robocopy data\attachments E:\Backup\LANChat\attachments /E
robocopy data\avatars E:\Backup\LANChat\avatars /E
robocopy data\keys E:\Backup\LANChat\keys /E
```

Không copy riêng `server.db` khi server đang chạy (thiếu phần trong `-wal`). Nên sao lưu `attachments/` định kỳ (vd. hằng tuần bằng Task Scheduler gọi file `.bat` trên).

**Khôi phục**: dừng server → xóa/đổi tên `data/` hiện tại → copy bản sao lưu vào `data/` (đặt `server.db` từ cách 2 vào `data/server.db`, xóa `server.db-wal`/`-shm` cũ nếu có) → chạy lại server.

## 6. Đóng gói (máy build CÓ internet)

```bash
cd server
npm ci
npm test
npm run package:win        # = node scripts/package-win.js
```

Script chạy được trên Windows / macOS / Linux:
1. Copy mã nguồn sang `dist/LANChat-Server/` (bỏ `data/`, `test/`, `dist/`, `scripts/`).
2. `npm install --omit=dev --os=win32 --cpu=x64 --ignore-scripts` → `sharp` lấy `@img/sharp-win32-x64`; `better-sqlite3` và `bcrypt`
   dùng prebuild N-API win32-x64 có sẵn trong package. Script **dừng ngay** nếu thiếu file `.node` win32-x64.
3. Tải Node.js Windows x64 chính thức (mặc định `v24.22.0`, đổi bằng `NODE_VERSION=v24.x.y`) vào `dist/.cache`, **kiểm tra SHASUMS256**,
   giải nén vào `LANChat-Server/node/`.
4. Tạo `dist/LANChat-Server-<version>-win-x64.zip`.

Biến môi trường: `NODE_VERSION`, `NODE_DIST_URL` (mirror nội bộ), `NODE_CACHE_DIR`, `SKIP_NODE_DOWNLOAD=1` (bỏ bước tải Node — gói khi đó cần Node cài sẵn trên máy đích).

Copy file zip sang máy server bằng USB → giải nén (vd. `D:\LANChat-Server`) → chạy `start-server.bat` lần đầu để kiểm tra.

## 7. Checklist kiểm thử trên máy offline thật

- [ ] Rút dây mạng internet / tắt Wi-Fi ra ngoài; chỉ còn LAN nội bộ.
- [ ] Giải nén zip, chạy `start-server.bat` → console hiện địa chỉ `ws://<IP>:5001/ws`, không có lỗi.
- [ ] `http://<IP>:5001/health` trả JSON từ máy khác trong LAN.
- [ ] Client trên máy khác tự thấy server trong danh sách (UDP 41234) trong ≤ 3–5 giây; nhập IP thủ công cũng kết nối được.
- [ ] Đăng ký user đầu tiên → có tab Chặn IP (manager). Đăng ký user thứ 2 → member.
- [ ] Trên máy chủ mở `http://localhost:5001/admin` → thấy nhật ký hoạt động; từ máy khác mở `http://<IP-máy-chủ>:5001/admin` → bị từ chối (403).
- [ ] Đăng nhập bằng username và bằng mã nhân viên (thử chữ HOA/thường). Sai mật khẩu → "Sai tên đăng nhập hoặc mật khẩu".
- [ ] Chat 1-1, tạo nhóm (≥ 2 người khác), gửi ảnh (có thumbnail), gửi file > 50MB, tải về.
- [ ] Trạng thái đã nhận / đã đọc cập nhật; sửa / thu hồi / ghim tin.
- [ ] Đổi avatar → máy khác thấy ngay.
- [ ] Chặn IP 1 máy client → client đó bị đăng xuất ngay; bỏ chặn → đăng nhập lại được.
- [ ] Tắt server → client chuyển P2P, chat tiếp; bật lại server → client tự đồng bộ ("Đã đồng bộ N tin").
- [ ] Khởi động lại máy server → dữ liệu còn nguyên; `data/logs/server/` có file log ngày hôm nay.
- [ ] Kiểm tra không có kết nối ra ngoài: `netstat -ano | findstr ESTABLISHED` chỉ thấy IP trong LAN.

## 8. Xử lý sự cố

| Triệu chứng | Cách xử lý |
|---|---|
| `Không mở được cổng 0.0.0.0:5001 ... EADDRINUSE` | Server khác đang chạy (kiểm tra Task Manager) hoặc đổi `server.port` trong `app-config.json` (client cần nhập cổng mới). |
| Client không tự thấy server | Mở firewall UDP 41234 trên cả 2 máy; 2 máy phải cùng subnet; router/AP có thể chặn broadcast (bật "client isolation" off) → nhập IP thủ công. Log `discovery_socket_error` trong `data/logs/server/` cho biết cổng UDP bị chiếm (server vẫn broadcast được). |
| Client kết nối được `/health` nhưng không đăng nhập | Kiểm tra IP máy client có bị chặn (Settings → Chặn IP) hoặc xem log `auth` trong `data/logs/server/`. |
| `File cấu hình ... không hợp lệ` | Sửa JSON trong `app-config.json` (thiếu dấu phẩy / ngoặc), hoặc xóa file để server tự sinh lại. |
| Lỗi `better-sqlite3` / `sharp` khi khởi động trên Windows | Gói được build sai nền tảng — đóng gói lại bằng `npm run package:win` (script kiểm tra binary win32-x64). |
| Mọi người bị đăng xuất sau khi khôi phục | Thư mục `data/keys/` không được khôi phục → khóa ký token mới. Khôi phục `keys/` từ bản sao lưu hoặc đăng nhập lại. |
| Upload báo 413 | File > 200MB (giới hạn `upload.maxFileSize`). |
| Server tắt ngay khi chạy `.vbs` | Chạy `start-server.bat` để xem lỗi trên console. |

## 9. Phát triển

```bash
npm install
npm test                    # node --test test/ (server chạy in-process, cổng ngẫu nhiên, thư mục tạm)
LANCHAT_PORT=5099 LANCHAT_DATA_DIR=/tmp/lanchat-dev node index.js
```

- Cấu trúc thư mục (gom theo tính năng):

```
be/
├── index.js                  entry: node index.js
├── src/
│   ├── core/                 server.js (khởi động/tắt), hub.js (sổ socket), errors.js,
│   │                         config/ (paths, configLoader...), db/ (database + repositories.js), utils/
│   ├── transport/            http.js, ws.js (route event → service), discovery.js (UDP 41234)
│   ├── modules/              mỗi tính năng gồm service (nghiệp vụ, không SQL) + repository (chỉ SQL)
│   │   ├── auth/             authService, tokenService (Ed25519), userRepo, sessionRepo
│   │   ├── chat/             messageService, conversationService, messageRepo, conversationRepo...
│   │   ├── file/   sync/   presence/   admin/   log/
│   └── shared/               BẢN GỐC file dùng chung (copy sang fe/shared)
├── test/   scripts/package-win.js
└── app-config.json, start-server.bat, start-server.vbs
```
- Luồng: `transport/` → `modules/*/…Service` → `modules/*/…Repo` → `core/db/database.js`.
- Mọi đường dẫn qua `src/core/config/paths.js`; mọi tên event / hằng số qua `src/shared/`.
- Giao thức: [`docs/PROTOCOL.md`](../docs/PROTOCOL.md). Session token: `base64url(payload) + "." + base64url(Ed25519 signature)`,
  chữ ký tính trên **chuỗi ASCII phần payload base64url** (giống JWS signing input); verify bằng `server_public_key` (PEM SPKI).

### ⚠️ Quy tắc file shared

`src/shared/` (`constants.js`, `wsEvents.js`, `validators.js`, `serializer.js`, `vectorClock.js`) là **bản gốc**, được copy sang
`fe/shared/`. Sửa file nào trong `be/src/shared/` → chạy **ngay** ở thư mục gốc repo:

```bash
npm run sync:shared
```

Không dùng symlink (lỗi khi build trên Windows). Không sửa trực tiếp bản copy bên client.
