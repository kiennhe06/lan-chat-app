# LAN Chat — Đặc tả giao thức (hợp đồng giữa server / client main / renderer)

> 2 RULE BẮT BUỘC: (1) Portable — không cài đặt, không registry, mọi dữ liệu nằm cạnh `.exe` / `index.js`.
> (2) Máy KHÔNG có internet, chỉ LAN — runtime 100% offline: không CDN, không font online, không analytics,
> không auto-update, WebRTC `iceServers: []`.

Tên event: luôn dùng hằng trong `shared/wsEvents.js` (dưới đây ghi giá trị chuỗi để dễ đọc).
Hằng số: `shared/constants.js`. Shape object: `shared/serializer.js` (WireUser / WireMessage / WireConversation / WireFile).

---

## 0. Quy ước chung

- Thời gian: ISO 8601 UTC string (`new Date().toISOString()`), **server là nguồn thời gian duy nhất**.
  Client chỉ dùng giờ local cho `created_at_local` của tin pending/P2P.
- `conversation_id` trên dây LUÔN là string: `"12"` (id server) hoặc `"temp-<uuid>"` (tạo offline).
- Mọi thao tác trên tin nhắn (reply, edit, recall, pin) tham chiếu bằng `client_message_id` (UUID v4 do client sinh)
  → hoạt động được cả khi P2P. `server_id` (INTEGER) dùng cho thứ tự + con trỏ đã nhận/đã đọc.
- Lỗi: `{ code: ERROR_CODE.*, message: string tiếng Việt }`.

### 0.1 Frame WebSocket (server :5001 và P2P :5002)

```json
{ "type": "message:send", "data": { ... }, "reqId": "r-17" }
{ "type": "message:sent", "data": { ... }, "reqId": "r-17" }
{ "type": "auth:login:err", "reqId": "r-3", "error": { "code": "INVALID_CREDENTIALS", "message": "Sai tên đăng nhập hoặc mật khẩu" } }
```

- Client gửi request kèm `reqId` → server trả **đúng 1** frame có cùng `reqId` (event kết quả hoặc event lỗi).
  Nếu không có event `:err` riêng, server dùng event kết quả kèm `error`.
- Frame không có `reqId` = push event (broadcast).
- Heartbeat: dùng ping/pong control frame của thư viện `ws` (15s). Server terminate socket không pong.

---

## 1. Xác thực

### 1.1 Session token (JWT-like, ký Ed25519)

- Server tạo cặp khóa Ed25519 lần chạy đầu: `data/keys/server-ed25519.pem` (private) + public.
- Token = `base64url(JSON payload) + "." + base64url(signature)`.
  Payload: `{ "uid": 5, "un": "anh.nv", "dn": "Nguyễn Văn Anh", "iat": 1700000000000, "exp": 1700604800000, "jti": "<hex16>" }`
  (`exp = iat + SESSION_TTL_MS` = 7 ngày).
- Server lưu `sessions(jti, user_id, expires_at, revoked)` để thu hồi khi logout/đổi mật khẩu.
- Login trả kèm `server_public_key` (PEM SPKI). Client cache vào `client.db settings` → peer tự verify token của nhau
  khi server offline (không cần server, không lộ hash mật khẩu).
- KHÔNG có login offline bằng password, KHÔNG đăng ký / đổi mật khẩu khi offline.

### 1.2 Kết nối

`ws://<host>:5001/ws` — frame đầu tiên phải là `auth:login`, `auth:register` hoặc `auth:reconnect`.
Chưa auth mà gửi event khác → `error {code: UNAUTHORIZED}`. Không auth trong 10s → đóng socket.
IP bị chặn → server gửi `auth:kicked {reason}` rồi đóng (cả lúc kết nối lẫn khi manager chặn sau đó).

| Request | data | Kết quả OK | Lỗi |
|---|---|---|---|
| `auth:register` | `{username, employee_id, display_name, password}` | `auth:register:ok` = LoginPayload | `auth:register:err` (VALIDATION / DUPLICATE) |
| `auth:login` | `{identifier, password}` (identifier = username HOẶC employee_id, so khớp không phân biệt hoa thường) | `auth:login:ok` = LoginPayload | `auth:login:err` (luôn message "Sai tên đăng nhập hoặc mật khẩu") |
| `auth:reconnect` | `{session_token}` | `auth:reconnect:ok` = LoginPayload (token cũ được giữ nguyên nếu còn > 1 ngày, không thì cấp mới) | `auth:reconnect:err` (SESSION_EXPIRED / UNAUTHORIZED) |
| `auth:logout` | `{}` | `auth:logout:ok` (thu hồi jti) | |

**LoginPayload**
```json
{
  "user": WireUser,
  "session_token": "eyJ1aWQ...sig",
  "expires_at": "2026-10-25T08:00:00.000Z",
  "server_public_key": "-----BEGIN PUBLIC KEY-----...",
  "server_time": "2026-10-18T08:00:00.000Z",
  "settings": { "theme": "light" }
}
```
User đăng ký đầu tiên trên server có `role = "manager"`. Sau register thành công server broadcast `user:created {user}` cho mọi socket đã auth.

### 1.3 Hồ sơ / người dùng

| Request | data | Kết quả |
|---|---|---|
| `user:list` | `{}` | `user:list:result {users: WireUser[] (kèm online)}` |
| `user:updateProfile` | `{display_name}` | `user:updateProfile:result {user}` + broadcast `user:updated {user}` |
| `user:changePassword` | `{old_password, new_password}` | `user:changePassword:result {ok:true, session_token, expires_at}` (thu hồi mọi session cũ khác) |
| `user:updateSettings` | `{theme}` | `user:updateSettings:result {settings}` |

Avatar: HTTP `POST /avatar` (mục 6) → server broadcast `user:updated {user}`.

---

## 2. Presence & typing

- `presence:list {online_user_ids: number[]}` — server push ngay sau auth OK.
- `presence {user_id, online: boolean}` — broadcast khi user có socket đầu tiên / mất socket cuối cùng.
- Client → server `typing {conversation_id}` (client throttle 1.5s). Server relay tới các member khác:
  `typing {conversation_id, user_id, display_name}`. Client ẩn sau 3s nếu không nhận thêm.

---

## 3. Tin nhắn

### 3.1 Gửi
Client → `message:send` (có reqId):
```json
{ "client_message_id": "uuid", "conversation_id": "12", "type": "text|image|file",
  "content": "xin chào @Anh", "reply_to": "uuid|null", "file_id": 33 | null,
  "mentions": [5], "vector_clock": {"3": 10}, "created_at_local": "ISO" }
```
- Idempotent theo `client_message_id`: gửi lại → trả lại bản đã lưu.
- Server → người gửi: `message:sent {message: WireMessage}` (cùng reqId).
- Server → mọi member (kể cả các socket của người gửi): `message:new {message: WireMessage}`.
  Client dedup theo `client_message_id`.
- Tin `image`: `content` là text kèm theo (có thể rỗng), `file` là ảnh. UI: ảnh trên, divider, text dưới.

### 3.2 Đã nhận / đã đọc (con trỏ, chỉ tiến)
- Client main tự gửi `message:delivered {conversation_id, server_id}` khi nhận `message:new` / sync.
- Client gửi `message:read {conversation_id, server_id}` khi user mở conversation / thấy tin cuối.
- Server cập nhật `conversation_members.last_delivered_message_id / last_read_message_id = MAX(cũ, mới)`
  (read ⇒ delivered cũng ≥), rồi broadcast cho mọi member:
  `message:status_update {conversation_id, user_id, last_delivered_message_id, last_read_message_id}`.
- Renderer tính trạng thái tin của MÌNH:
  - không có `server_id`: `pending` (⏳/📤 theo sync_state) hoặc `sent` (đã tới peer).
  - có `server_id`: `read` nếu (1-1) người kia `last_read ≥ server_id`; (group) có ≥1 member khác đã đọc.
    `delivered` nếu có member khác `last_delivered ≥ server_id`. Ngược lại `sent`.
  - Group: `readers = members khác có last_read ≥ server_id`, hiển thị "Đã đọc X/Y" (Y = số member trừ người gửi).

### 3.3 Sửa / thu hồi / ghim
| Request | data | Broadcast | Quyền |
|---|---|---|---|
| `message:edit` | `{conversation_id, client_message_id, content}` | `message:edited {message}` | người gửi, chỉ tin `text` |
| `message:recall` | `{conversation_id, client_message_id}` | `message:recalled {conversation_id, client_message_id}` | người gửi |
| `message:pin` | `{conversation_id, client_message_id}` | `conv:pinned {conversation_id, pinned: WirePin[]}` | owner/admin (group); cả 2 người (1-1) |
| `message:unpin` | `{conversation_id, client_message_id}` | `conv:unpinned {conversation_id, pinned: WirePin[]}` | như trên |
| `message:history` | `{conversation_id, before_server_id?, limit≤50}` | → `message:history:result {conversation_id, messages: WireMessage[], has_more}` | member |

Ack cho edit/recall/pin/unpin: `message:result {ok:true}` (cùng reqId) hoặc kèm `error`.

---

## 4. Conversation & nhóm

**WireConversation**: xem `serializer.toWireConversation`. `members[]` gồm `{user_id, role, last_read_message_id, last_delivered_message_id}`.
`pending_count` chỉ khác 0 khi người nhận là owner/admin.

| Request | data | Kết quả (reqId) | Broadcast |
|---|---|---|---|
| `conv:list` | `{}` | `conv:list:result {conversations}` | |
| `conv:create` | `{type:"direct", member_ids:[otherId]}` → find-or-create theo cặp user | `conv:created {conversation}` | `conv:created` tới cả 2 |
| `conv:create` | `{type:"group", name, member_ids:[…≥2 người khác], client_temp_id?}` | `conv:created {conversation}` | `conv:created` tới mọi member (có `client_temp_id` để client map id tạm → id thật) |
| `conv:rename` | `{conversation_id, name, version?, updated_at?}` | `conv:result` | `conv:updated {conversation}` + tin system |
| `conv:addMember` | `{conversation_id, user_ids}` | `conv:addMemberResult {added:[ids], pending:[ids]}` | added → `conv:updated` + người mới nhận `conv:created`; pending → owner/admin nhận `conv:memberPending {conversation_id, pending_count}` |
| `conv:approveMember` / `conv:rejectMember` | `{conversation_id, user_id}` | `conv:result` | approve → như added; cả 2 → `conv:memberPending` cập nhật số |
| `conv:removeMember` | `{conversation_id, user_id}` | `conv:result` | người bị xóa nhận `conv:deleted {conversation_id}`; còn lại `conv:updated` |
| `conv:setAdmin` | `{conversation_id, user_id, is_admin}` | `conv:result` | `conv:updated` |
| `conv:delete` | `{conversation_id}` | `conv:result` | `conv:deleted {conversation_id}` tới mọi member |
| `conv:requestPending` | `{conversation_id}` | `conv:pendingList {conversation_id, pending:[{user_id, requested_by, created_at}]}` | |

Quy tắc quyền (server enforce, client chỉ ẩn/hiện nút):
- Đổi tên: mọi member. Thêm member: owner/admin trực tiếp, member → pending.
- Duyệt/Từ chối pending, xóa member: owner/admin; không ai xóa được owner; không tự xóa mình qua nút ✕.
- Set/Hủy phó nhóm: chỉ owner. Xóa nhóm: chỉ owner. Ghim: owner/admin.
- Tin system (type `system`) được server chèn khi: tạo nhóm, đổi tên, thêm/xóa member, set admin.

---

## 5. Đồng bộ (reconciliation) — trigger khi WS tới server mở lại + auth OK

Thứ tự client thực hiện (`syncClient.js`):
1. `sync:request {since_server_id: <max server_id local>, known_conversation_ids: [...]}`
   → `sync:response {conversations: WireConversation[], users: WireUser[], messages: WireMessage[] (server_id > since, tối đa 2000, mới nhất), deleted_conversation_ids: [], server_time, has_more}`.
   Client upsert vào client.db, rồi gửi `message:delivered` cho tin mới nhất mỗi conversation.
2. Client phát sự kiện local `sync:status {pending_messages, pending_actions, pending_files}` (renderer hiển thị).
3. `sync:action-batch` cho action `conv_create` trước (để có id thật):
   `{actions:[{client_action_id, action_type, payload, vector_clock, created_at}]}`
   → `sync:action-batch-ack {results:[{client_action_id, ok, result?, error?, conflict?}]}`.
   - `conv_create.payload = {client_temp_id, name, member_ids}` → `result = {conversation}`.
   - `conv_rename.payload = {conversation_id, name, version, updated_at}` → conflict LWW theo `(updated_at, user_id)`:
     server chỉ áp dụng nếu `(updated_at, user_id)` mới hơn bản đang có; nếu không → `conflict:true, result:{conversation}` (keep server).
   - `message_edit.payload = {conversation_id, client_message_id, content, updated_at}`, `message_recall.payload = {conversation_id, client_message_id}`.
4. `sync:file-batch {files:[{sha256, size, name, mime_type}]}` → `sync:file-batch-ack {missing:[sha256], existing:[{sha256, file: WireFile}]}`.
   Client upload các file `missing` qua `POST /upload` (đọc từ đường dẫn gốc / `downloads-p2p`), lấy `file_id`.
5. `sync:message-batch {messages:[{client_message_id, conversation_id, sender_id, type, content, reply_to, file_sha256?, file_id?, mentions, vector_clock, created_at_local}]}`
   (tối đa 100 tin/batch; gồm sync_state ∈ `pending_server`, `peer_synced`, `pending_peer`, `partial_peer` có `sender_id = mình`, và `peer_synced` của người khác)
   → `sync:message-batch-ack {results:[{client_message_id, ok, server_id?, created_at?, status: "ok"|"conflict"|"error", error?}]}`.
   - Server upsert theo `client_message_id` (idempotent). `conversation_id` dạng `temp-…` được map qua `conversations.client_temp_id`;
     chưa map được → `error.code = CONV_NOT_SYNCED` (client giữ lại, thử lần sau).
   - Server chấp nhận tin do peer chuyển hộ (`sender_id ≠` người gửi batch) nếu cả 2 đều là member.
   - Server broadcast `message:new` cho các tin mới tạo.
   - Conflict 409 → mặc định giữ bản server, client log warning.
6. Client gửi `sync:ack {last_server_id}`; renderer hiển thị toast "Đã đồng bộ N tin, M file".

Tiến trình (local event `sync:progress {phase, done, total}`) hiển thị thanh nhỏ ở header, không block UI.

---

## 6. HTTP (cùng cổng 5001)

| Method | Path | Auth | Mô tả |
|---|---|---|---|
| GET | `/health` | không | `{app:"LANChat", version, server_time}` |
| POST | `/upload` | `Authorization: Bearer <token>` | Body = raw bytes. Header `X-File-Name: <encodeURIComponent(name)>`, `Content-Type`, `Content-Length`. Giới hạn 200MB → 413. Server stream ra file tạm + tính SHA-256, dedup theo hash, sinh thumbnail (sharp, max 400px, webp) cho ảnh. Trả `{file: WireFile}` |
| GET | `/download/:fileId` | Bearer hoặc `?token=` | Stream file gốc, `Content-Disposition: attachment; filename*=UTF-8''…`, hỗ trợ `Content-Length` |
| GET | `/file/by-hash/:sha256` | Bearer hoặc `?token=` | Như trên nhưng theo hash (client cache ảnh gốc) |
| HEAD | `/file/by-hash/:sha256` | Bearer | 200 nếu có, 404 nếu không |
| GET | `/thumb/:sha256` | không (hash khó đoán) | thumbnail webp |
| POST | `/avatar` | Bearer | Body raw ảnh ≤10MB → sharp 256×256 cover webp → `{user}` + broadcast `user:updated` |
| GET | `/avatar/:name` | không | file avatar |

Mọi route kiểm tra IP bị chặn (403). Tên file lưu trên đĩa = `<sha256>` (không dùng tên gốc → chống traversal).

---

## 7. UDP discovery

### 7.1 Server → client (cổng 41234)
Server broadcast mỗi 3s tới `255.255.255.255` và broadcast address của từng interface:
```json
{ "type": "server:announce", "app_name": "LANChat", "server_name": "LANChat Server", "host": "192.168.1.5",
  "port": 5001, "version": "1.0.0", "server_online": true }
```
Client có thể gửi `{type:"client:probe", app_name:"LANChat"}` tới broadcast :41234 → server trả unicast announce.
Client bỏ server khỏi danh sách nếu không nghe thấy trong 10s. Người dùng luôn có ô nhập IP thủ công.

### 7.2 Peer ↔ peer (cổng 5003)
Client broadcast mỗi 5s:
```json
{ "type": "peer:announce", "app_name": "LANChat", "instance_id": "uuid", "peer_port": 5002,
  "user_id": 5, "display_name": "Anh", "server_online": true }
```
Server cũng broadcast `server:announce` lên :5003 (`peerDiscoveryBroadcast.js`) để client biết server sống.
Xóa peer nếu miss 3 lần (15s). Bỏ qua gói của chính mình (`instance_id`).

---

## 8. P2P (WebSocket :5002 giữa các client)

- P2P server chỉ chấp nhận IP **cùng subnet** với một interface local (so theo netmask) hoặc loopback.
- Handshake: bên kết nối gửi `p2p:hello {session_token, instance_id, vector_clock}`;
  bên nhận verify chữ ký bằng `server_public_key` đã cache + `exp` → trả `p2p:hello-ack {session_token, instance_id, vector_clock}`
  (bên kia verify ngược lại). Sai → `p2p:error {code: UNAUTHORIZED}` + đóng.
- `p2p:message {message: WireMessage (server_id=null), conversation?: WireConversation}` (kèm conversation khi là nhóm tạm `temp-…`)
  → `p2p:message-ack {client_message_id, received_at}`.
  Nhận: merge vector clock, insert local `sync_state='peer_synced'`, status `sent`.
  Gửi (1-1): ACK → `sync_state='pending_server', status='sent'`; peer không online → giữ `pending_peer`, retry khi peer xuất hiện.
  Gửi (group): gửi tới mọi peer member đang online; ghi `p2p_receipts {user_id: ts}`;
  đủ hết member → `pending_server` + `sent`; thiếu → `partial_peer`.
- `p2p:message-edit {conversation_id, client_message_id, content, updated_at}`, `p2p:message-recall {conversation_id, client_message_id}`.
- `p2p:typing {conversation_id, user_id, display_name}`, `p2p:presence {user_id, server_online}`.
- `p2p:conv-sync {conversation: WireConversation}` — tạo/đổi tên nhóm offline (LWW theo `(updated_at, user_id)`).
- File: `p2p:file-start {transfer_id, sha256, name, size, mime_type, chunk_size: 524288, total_chunks, client_message_id}`
  → các **binary frame**: 36 byte đầu = `transfer_id` (UUID ASCII) + 4 byte uint32 BE chunk index + dữ liệu
  → `p2p:file-complete {transfer_id}` → bên nhận ghép tại `data/downloads-p2p/<sha256>/<tên đã sanitize>`, verify SHA-256
  → `p2p:file-ack {transfer_id, sha256, ok, error?}`. Ghi `p2p_files`.
  Khi server online, bên gửi upload file gốc lên server (sync bước 4).

---

## 9. Log

- Client → `log:batch {logs:[LogEntry]}` → `log:ack {ids:[log_id]}`; `audit` gửi ngay qua `log:event {log}`.
- LogEntry JSONL: `{log_id, ts, level, category, user_id, client_id, action, ip?, meta?}` — đã redact password/token/secret/authorization.
- **Xem log KHÔNG đi qua WebSocket.** Chỉ máy chủ xem được, qua trang web `http://localhost:<port>/admin` (be/src/modules/log/adminLogRoutes.js):
  - Chỉ nhận request từ IP loopback + Host `localhost`/`127.0.0.1`/`[::1]` (chặn máy khác trong LAN và DNS rebinding), không gửi header CORS.
  - `GET /admin/api/logs?user_id&category&min_level&level&action&from&to&q&users_only&limit≤2000` → `{success, logs:[LogEntry + username, display_name, employee_id, conversation_label, file_name, target_names], truncated}`.
  - `GET /admin/api/users`, `GET /admin/api/export?…` (.jsonl).
- Server tự gắn IP client cho mọi log phát sinh trong lúc xử lý 1 frame WS / request HTTP (`core/requestContext.js`).
- Không ghi nội dung tin nhắn (`message_sent` chỉ có conversation_id + loại tin), trừ khi bật `logging.logMessageContent`.

## 10. Admin (chỉ manager)

| Request | data | Kết quả |
|---|---|---|
| `admin:listBlocked` | `{}` | `admin:blockedList {blocked:[{ip, reason, blocked_by, created_at}]}` |
| `admin:blockIp` | `{ip, reason}` | `admin:blockIpResult {blocked, kicked_count}` — kick ngay socket đang dùng IP đó (`auth:kicked`) |
| `admin:unblockIp` | `{ip}` | `admin:unblockIpResult {ip}` |

## 11. WebRTC (TẠM TẮT)
`call:offer {to_user_id, sdp}` → server relay kèm `from_user_id, from_name`; `call:answer`, `call:ice-candidate`, `call:end`.
`RTCPeerConnection({ iceServers: [] })` — chỉ host candidate LAN.

---

## 12. IPC Electron (preload `window.api`) — xem `fe/preload/index.js` (nguồn sự thật)

Main → renderer push events (đăng ký qua `window.api.on(channel, cb)`), tên kênh trong `IPC_EVENTS`:

| Kênh | payload |
|---|---|
| `evt:connection` | `{state: "disconnected"|"connecting"|"online"|"offline_p2p", server: {host, port}|null, serverOnline, error?}` |
| `evt:auth` | `{state: "logged_in"|"logged_out"|"kicked"|"session_expired", user?, reason?}` |
| `evt:servers` | `ServerInfo[]` = `[{host, port, server_name, version, last_seen}]` |
| `evt:peers` | `[{user_id, display_name, ip, port, server_online, last_seen}]` |
| `evt:message` | `{message: LocalMessage}` (upsert: mới / sửa / thu hồi / đổi trạng thái / đổi sync_state) |
| `evt:message-removed` | `{conversation_id, client_message_id}` |
| `evt:conversation` | `{conversation: LocalConversation}` (upsert) |
| `evt:conversation-removed` | `{conversation_id}` |
| `evt:conversation-id-changed` | `{old_id, new_id}` (temp → thật) |
| `evt:users` | `{users: LocalUser[]}` (upsert, kèm online) |
| `evt:presence` | `{user_id, online}` |
| `evt:typing` | `{conversation_id, user_id, display_name}` |
| `evt:status` | `{conversation_id, user_id, last_delivered_message_id, last_read_message_id}` |
| `evt:pinned` | `{conversation_id, pinned: WirePin[]}` |
| `evt:pending` | `{conversation_id, pending_count}` |
| `evt:sync-progress` | `{phase: "messages"|"actions"|"files"|"pull", done, total}` |
| `evt:sync-done` | `{messages, files, conflicts}` |
| `evt:upload-progress` | `{client_message_id, percent, state: "uploading"|"done"|"error"|"cancelled", error?}` |
| `evt:download-progress` | `{download_id, client_message_id, percent, state: "downloading"|"done"|"error"|"cancelled", local_path?, error?}` |
| `evt:call` | `{type: call event, data}` (tạm tắt) |
| `evt:notification-click` | `{conversation_id}` |
| `evt:toast` | `{kind: "info"|"success"|"warn"|"error", text}` |

**LocalMessage** = WireMessage + `{local_id, status, sync_state, local_path, p2p_receipts, upload_percent?}`.
**LocalConversation** = WireConversation + `{unread_count, sync_state, last_message_at, my_role}`.
**LocalUser** = WireUser + `{online}`.

Ảnh/avatars hiển thị qua custom protocol do main đăng ký (offline vẫn xem được nếu đã cache):
- `lcfile://thumb/<sha256>` → cache `data/cache/thumbs/` → server `/thumb` → p2p_files.
- `lcfile://image/<sha256>` → `local_path` / `data/downloads-p2p` / cache `data/cache/images/` → server `/file/by-hash`.
- `lcfile://avatar/<name>` → cache `data/cache/avatars/` → server `/avatar/<name>`.
