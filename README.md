# LAN Chat

Hệ thống chat nội bộ cho văn phòng **không có internet**, chỉ kết nối qua **mạng LAN**.

> ## 2 RULE BẮT BUỘC
> 1. **Portable — không cần cài đặt.** Client là 1 file `LAN-Chat-1.0.0.exe`, server là 1 thư mục zip chạy bằng Node portable kèm theo. Không ghi registry, không ghi `%APPDATA%`; mọi dữ liệu nằm trong thư mục `data/` cạnh file chạy.
> 2. **Máy không có internet — chỉ LAN.** Runtime offline 100%: không CDN, không font online, không analytics, không auto-update. Server tự quảng bá qua UDP broadcast, client cũng nhập IP thủ công được. Khi server tắt, các client vẫn chat P2P với nhau và tự đồng bộ lại khi server online.

## Cấu trúc

| Thư mục | Nội dung |
|---|---|
| `be/` (backend) | Server Node.js thuần (`node index.js`), không Electron, không UI. Đóng gói thành `LANChat-Server-<ver>-win-x64.zip` (kèm `node/node.exe`). Xem [be/README.md](be/README.md) |
| `fe/` (frontend) | App desktop Electron (package `lan-chat-app`), đóng gói `.exe` portable. Xem [fe/README.md](fe/README.md) |
| `docs/PROTOCOL.md` | Đặc tả giao thức WS / HTTP / UDP / P2P / IPC |
| `scripts/sync-shared.js` | Copy `be/src/shared/*` → `fe/shared/` |

## Shared code

`be/src/shared/` là **bản gốc** của `constants.js`, `wsEvents.js`, `validators.js`, `serializer.js`, `vectorClock.js`.
Bản copy nằm ở `fe/shared/` (không dùng symlink vì lỗi khi build trên Windows).
**Sửa file shared ở server → chạy ngay:**

```bash
npm run sync:shared
```

## Tải bản dựng sẵn (không cần build)

File `.exe` và zip server **không nằm trong mã nguồn** (git). Tải ở trang Releases:
**https://github.com/kiennhe06/lan-chat-app/releases** → `LAN-Chat-1.0.0.exe`, `LANChat-Server-1.0.0-win-x64.zip`, `HUONG-DAN-SU-DUNG.txt`.

## Xem giao diện khi chưa muốn build (cần Node 22+)

Cách 1: chỉ giao diện, dùng **dữ liệu giả**, không cần server. Mở trình duyệt vào http://127.0.0.1:5173,
đăng nhập bằng `an.nv` (hoặc `NV001`) với mật khẩu bất kỳ từ 6 ký tự:

```bash
cd fe && npm ci && npm run dev:renderer
```

Cách 2: app thật (cửa sổ Electron) + server thật, mở 2 terminal:

```bash
cd be && npm ci && npm start
```

```bash
cd fe && npm ci && npm run dev
```

App mở ra → chọn server `127.0.0.1`, cổng `5001` → Đăng ký. Trang nhật ký: http://localhost:5001/admin

## Build ra file `.exe` / zip (máy CÓ internet)

```bash
cd fe && npm ci && npm run dist:win
```

→ `fe/release/LAN-Chat-1.0.0.exe`

```bash
cd be && npm ci && npm run package:win
```

→ `be/dist/LANChat-Server-1.0.0-win-x64.zip` (tự tải kèm Node 22 portable)

- Build được trên Windows, macOS hoặc Linux, không cần Visual Studio: `better-sqlite3` (v13) và `bcrypt` (v6) dùng **N-API prebuild** có sẵn cho `win32-x64`.
- `sharp` (chỉ server) được cài bản `win32-x64` bởi `package-win.js` (`npm install --os=win32 --cpu=x64`).
- Test: `cd be && npm test`, `cd fe && npm test`.

## Triển khai (máy offline)

| Máy | Chạy gì |
|---|---|
| Máy chủ | Giải nén zip server → bấm đúp `start-server.bat` (lần sau có thể dùng `start-server.vbs` để chạy ẩn). Sau đó bấm đúp `LAN-Chat-1.0.0.exe` |
| Nhân viên | Copy `LAN-Chat-1.0.0.exe` vào một thư mục riêng → bấm đúp |

Không cần quyền admin. Chỉ máy chủ cần cho phép kết nối vào TCP 5001: kiểm tra bằng cách mở
`http://<IP-máy-chủ>:5001/health` từ máy khác (chi tiết: mục C3 trong `docs/HUONG-DAN-SU-DUNG.txt`).

Người dùng đăng ký **đầu tiên** trên server trở thành **manager** (chặn IP). Nhật ký hoạt động chỉ xem trên máy chủ: `http://localhost:5001/admin`.
