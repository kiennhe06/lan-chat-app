# LAN Chat

Hệ thống chat nội bộ cho văn phòng **không có internet**, chỉ kết nối qua **mạng LAN**.

> ## 2 RULE BẮT BUỘC
> 1. **Portable — không cần cài đặt.** Client là 1 file `LAN Chat-1.0.0.exe`, server là 1 thư mục zip chạy bằng Node portable kèm theo. Không ghi registry, không ghi `%APPDATA%`; mọi dữ liệu nằm trong thư mục `data/` cạnh file chạy.
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

## Build (máy CÓ internet, chỉ làm 1 lần)

```bash
cd server && npm ci && npm run package:win
```

```bash
cd client && npm ci && npm run electron:rebuild && npm run dist:win
```

- `better-sqlite3` (v13) và `bcrypt` (v6) dùng **N-API prebuild** có sẵn cho `win32-x64` trong package → cùng 1 binary chạy cho cả Node lẫn Electron, không cần Visual Studio Build Tools. `electron:rebuild` chỉ kiểm tra binary có mặt.
- `sharp` (chỉ server) được cài bản `win32-x64` bởi `package-win.js` (`npm install --os=win32 --cpu=x64`).

Kết quả: `be/dist/LANChat-Server-1.0.0-win-x64.zip` và `fe/release/LAN Chat-1.0.0.exe`. Copy 2 file này sang máy LAN bằng USB.

## Triển khai (máy offline)

| Máy | Chạy gì |
|---|---|
| Manager | Giải nén zip server → double-click `start-server.vbs` (chạy ẩn) hoặc `start-server.bat` (có console). Sau đó double-click `LAN Chat-1.0.0.exe` |
| Nhân viên | Chỉ double-click `LAN Chat-1.0.0.exe` |

Mở firewall Windows (chạy CMD quyền Admin một lần trên mỗi máy) — chi tiết trong `be/README.md`:
- Server: TCP 5001, UDP 41234
- Client: TCP 5002, UDP 5003

Người dùng đăng ký **đầu tiên** trên server trở thành **manager** (xem log, chặn IP).
