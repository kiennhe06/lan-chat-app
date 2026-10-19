# LAN Chat — Client (Electron portable)

Ứng dụng chat nội bộ chạy **100% offline trong mạng LAN**, đóng gói thành **một file `.exe` portable**
(không cài đặt, không ghi registry, không dùng `%APPDATA%`). Khi server offline, client tự chuyển sang
**P2P mesh** giữa các máy và tự đồng bộ lại khi server online.

## Chạy & build

| Lệnh | Mục đích |
|---|---|
| `npm run dev` | Vite (renderer) + Electron (`--dev-server=http://127.0.0.1:5173`) |
| `npm start` | Electron load `dist/renderer/index.html` (cần `npm run build:renderer` trước) |
| `npm test` (= `node --test test/`) | Test main process (repositories, sync, P2P, token, log...) |
| `npm run dist:win` | Build renderer + `electron-builder --win portable --x64` → `release/LAN-Chat-1.0.0.exe` |
| `node scripts/generate-icons.js` | Sinh lại `build/icon.png`, `icon.ico`, `tray-icon.png` (dùng sharp của `../server`, chỉ lúc dev) |

Cờ dòng lệnh của main: `--hidden` (khởi động ẩn, dùng cho shortcut tự khởi động), `--smoke-test`
(khởi tạo toàn bộ rồi thoát sau ~3s; exit 0 = OK, 1 = lỗi init).

Chạy 2 client trên 1 máy để test P2P:

```bash
LANCHAT_CLIENT_BASE_DIR=/tmp/clientA LANCHAT_P2P_PORT=5102 npx electron .
LANCHAT_CLIENT_BASE_DIR=/tmp/clientB LANCHAT_P2P_PORT=5202 npx electron .
```

## Dữ liệu (cạnh file .exe)

```
<thư mục chứa .exe>/
├── LAN-Chat-1.0.0.exe
├── app-config.json            ← tự sinh lần chạy đầu
└── data/
    ├── client.db              ← SQLite WAL (lịch sử, cache, hàng đợi offline)
    ├── downloads/             ← thư mục mặc định khi "Tải xuống"
    ├── downloads-p2p/<sha256>/← file nhận qua P2P (đã verify SHA-256)
    ├── cache/{thumbs,images,avatars}/ ← cache ảnh cho lcfile:// (xem offline)
    ├── logs/clients/YYYY-MM-DD.jsonl  ← log client (xoay vòng ngày + 10MB, giữ 30 ngày)
    └── electron/              ← userData/session/crash dumps của Chromium
```

`BASE_DIR` = `PORTABLE_EXECUTABLE_DIR` (do electron-builder portable đặt) → `dirname(process.execPath)`;
dev: thư mục `fe/` hoặc `LANCHAT_CLIENT_BASE_DIR`.

## Cấu hình `app-config.json`

Ưu tiên: biến môi trường → `app-config.json` → mặc định.

| Khóa | Mặc định | Env |
|---|---|---|
| `server.host` / `server.port` | `""` / `5001` | `LANCHAT_SERVER_HOST`, `LANCHAT_SERVER_PORT` |
| `network.serverDiscoveryPort` | `41234` | `LANCHAT_SERVER_DISCOVERY_PORT` |
| `p2p.enabled` / `p2p.port` / `p2p.discoveryPort` | `true` / `5002` / `5003` | `LANCHAT_P2P_ENABLED`, `LANCHAT_P2P_PORT`, `LANCHAT_P2P_DISCOVERY_PORT` |
| `logging.level`, `logMessageContent`, `retentionDays`, `maxFileSizeMb`, `shipToServer` | `info`, `false`, `30`, `10`, `true` | `LANCHAT_LOG_LEVEL` |
| `notifications.enabled` | `true` | `LANCHAT_NOTIFICATIONS` |

## Cấu trúc thư mục

```
fe/
├── electron/                 main process (chạy nền trên máy nhân viên)
│   ├── main.js               bootstrap: setPath portable, single-instance, CSP, protocol, IPC, window, tray
│   ├── core/                 container (composition root), config/, db/ (database + repositories),
│   │                         ipc/ (register + gom handler), eventBus, windowManager, tray, lcfileProtocol, utils/
│   └── modules/              mỗi tính năng gồm service + repository + IPC handler của nó
│       ├── auth/             sessionService, tokenVerifier (Ed25519), authHandlers
│       ├── connection/       serverConnection (WS + reqId + reconnect), serverDiscovery (UDP 41234), httpClient
│       ├── chat/             chatService, inboundService, messageRepo, conversationCacheRepo, chatHandlers...
│       ├── p2p/              p2pServer (WS :5002), peerDiscovery (UDP :5003), peerRegistry, p2pService
│       ├── sync/             syncService, syncClient, actionQueueRepo
│       ├── file/             fileTransferService, fileCacheService, fileHandlers
│       ├── log/   admin/   app/
├── preload/index.js          window.api — hợp đồng IPC duy nhất giữa UI và electron/
├── ipc/channels.js           tên kênh IPC (dùng chung preload + electron)
├── shared/                   copy từ be/src/shared (npm run sync:shared)
├── ui/                       React (Vite)
│   ├── app/                  App, MainLayout, context/, api/ (cổng duy nhất gọi window.api), hooks dùng chung
│   ├── features/             auth/ chat/ conversations/ group/ settings/ admin/ connection/ call/
│   │                         — mỗi thư mục chứa component + hook của tính năng đó
│   ├── components/           component dùng chung (Modal, Avatar, Icons, ConfirmModal...)
│   └── dev/mockApi.js        giả lập window.api khi chạy UI trong trình duyệt (không vào bản build)
├── test/  scripts/  build/ (icon)
└── dist/ui/ (bản build UI)   release/ (file .exe)
```

Luồng: IPC handler → service → repository → SQLite. Service không import Electron (trừ adapter mỏng
`platform.js`, `windowManager.js`, `tray.js`, `autoStart.js`, `protocol/`).

## Offline / bảo mật

- Không gọi Internet lúc runtime: không auto-update, không crash upload, không font/CDN; Chromium chạy với
  `--disable-background-networking`. CSP production: `default-src 'self'; img-src 'self' data: blob: lcfile:; ...`.
- Popup/điều hướng ra ngoài bị chặn; link http(s) chỉ mở bằng trình duyệt hệ thống khi người dùng click.
- Token phiên ký Ed25519 bởi server, client verify local bằng `server_public_key` đã cache → P2P auth khi server offline.
- P2P chỉ nhận IP cùng subnet / loopback. Peer chỉ được gửi tin của chính mình (sender = user trong token).
- Log redact `password/token/secret/authorization`; app không log nội dung tin; nội dung tin được server ghi nhật ký (cấu hình `logging.logMessageContent` của server).
- "Ghi nhớ đăng nhập" không tick → token chỉ nằm trong RAM. Người khác đăng nhập trên cùng máy → xóa cache tin của tài khoản trước.

## Checklist test thật (máy offline)

1. Rút mạng Internet, chỉ giữ LAN. Chạy server, mở client → thấy server trong danh sách discovery.
2. Đăng ký 3 user trên 3 máy, chat 1-1, gửi ảnh/file, tải xuống, mở file/thư mục.
3. Tắt server → banner P2P; chat 1-1 (⏳ → 📤), nhóm thiếu member (partial_peer), tạo nhóm offline, gửi file P2P.
4. Bật lại server → toast "Đã đồng bộ N tin, M file", id nhóm tạm được thay bằng id thật trên mọi máy.
5. Đóng cửa sổ → app ẩn xuống tray, vẫn nhận notification; "Thoát" ở tray tắt hẳn.
6. Bật "Tự khởi động" → có `LAN Chat.lnk` trong `shell:startup`.
