/**
 * ⚠️ DEV-ONLY — giả lập toàn bộ `window.api` (preload) trong bộ nhớ để phát triển/kiểm thử UI
 * bằng trình duyệt thường (không Electron, không server).
 * Chỉ được nạp từ main.jsx khi `import.meta.env.DEV && !window.api` → bị loại khỏi bản build production.
 *
 * Đăng nhập thử: tên đăng nhập bất kỳ trong danh sách (vd. "an.nv" hoặc mã "NV001"), mật khẩu bất kỳ ≥ 6 ký tự.
 * Điều khiển: bảng nhỏ góc dưới trái (Server ON/OFF, tin đến, đồng bộ) hoặc `window.__lanchatMock`.
 */
import { FALLBACK_CONSTANTS, FALLBACK_GROUP_ACTIONS, FALLBACK_IPC_EVENTS, FALLBACK_WS_EVENTS } from '../app/config/fallbackConstants.js';

const C = FALLBACK_CONSTANTS;
const EV = FALLBACK_IPC_EVENTS;
const GA = FALLBACK_GROUP_ACTIONS;
const ME_ID = 1;
const PEER_DELAY_MS = 300;

// ───────────────────────── tiện ích ─────────────────────────
const uuid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
const nowIso = () => new Date().toISOString();
const clone = (v) => JSON.parse(JSON.stringify(v));
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (code, message) => Promise.reject({ code, message });
const fold = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .toLowerCase();

/** Ảnh SVG giả (data URI) cho thumbnail / ảnh gốc / avatar */
function svgDataUrl(seed, width, height, label) {
  let hash = 0;
  for (const ch of String(seed)) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  const hue = Math.abs(hash) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},70%,60%)"/><stop offset="1" stop-color="hsl(${(hue + 60) % 360},70%,40%)"/></linearGradient></defs>
<rect width="100%" height="100%" fill="url(#g)"/>
<circle cx="${width * 0.75}" cy="${height * 0.3}" r="${Math.min(width, height) * 0.12}" fill="rgba(255,255,255,0.7)"/>
<path d="M0 ${height} L${width * 0.35} ${height * 0.45} L${width * 0.6} ${height * 0.75} L${width * 0.8} ${height * 0.55} L${width} ${height} Z" fill="rgba(0,0,0,0.25)"/>
<text x="50%" y="92%" font-family="Segoe UI, Arial" font-size="${Math.round(height / 12)}" fill="white" text-anchor="middle">${label || ''}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

// ───────────────────────── validators (bản port của shared/validators.js) ─────────────────────────
const ok = (value) => ({ ok: true, value });
const bad = (error) => ({ ok: false, error });
const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const re = (o) => new RegExp(o.source, o.flags);

const validators = {
  normalizeUsername(raw) {
    const v = str(raw).trim();
    if (!v) return bad('Vui lòng nhập tên đăng nhập');
    if (/\s/.test(v)) return bad('Tên đăng nhập không được chứa khoảng trắng');
    if (v.length < C.USERNAME_MIN || v.length > C.USERNAME_MAX) return bad(`Tên đăng nhập dài ${C.USERNAME_MIN}–${C.USERNAME_MAX} ký tự`);
    if (!re(C.USERNAME_REGEX).test(v)) return bad('Tên đăng nhập chỉ gồm chữ không dấu, số và các ký tự _ . -');
    return ok(v);
  },
  normalizeEmployeeId(raw) {
    const v = str(raw).trim();
    if (!v) return bad('Vui lòng nhập mã nhân viên');
    if (/\s/.test(v)) return bad('Mã nhân viên không được chứa khoảng trắng');
    if (v.length > C.EMPLOYEE_ID_MAX) return bad(`Mã nhân viên tối đa ${C.EMPLOYEE_ID_MAX} ký tự`);
    if (!re(C.EMPLOYEE_ID_REGEX).test(v)) return bad('Mã nhân viên chỉ gồm chữ không dấu, số và các ký tự _ . -');
    return ok(v);
  },
  normalizeDisplayName(raw) {
    const v = str(raw).normalize('NFC').replace(/\s+/g, ' ').trim();
    if (!v) return bad('Vui lòng nhập tên hiển thị');
    if (Array.from(v).length > C.DISPLAY_NAME_MAX) return bad(`Tên hiển thị dài ${C.DISPLAY_NAME_MIN}–${C.DISPLAY_NAME_MAX} ký tự`);
    return ok(v);
  },
  validatePassword(raw) {
    const v = str(raw);
    if (!v) return bad('Vui lòng nhập mật khẩu');
    if (!re(C.PASSWORD_ASCII_REGEX).test(v)) return bad(C.MESSAGES_VI.PASSWORD_HINT);
    if (v.length < C.PASSWORD_MIN || v.length > C.PASSWORD_MAX) return bad(`Mật khẩu dài ${C.PASSWORD_MIN}–${C.PASSWORD_MAX} ký tự`);
    return ok(v);
  },
  passwordStrength(pw) {
    const p = str(pw);
    if (!p) return { score: 0, label: '' };
    let score = 0;
    if (p.length >= C.PASSWORD_MIN) score += 1;
    if (p.length >= 10) score += 1;
    if (/[a-z]/.test(p) && /[A-Z]/.test(p)) score += 1;
    if (/\d/.test(p) && /[^a-zA-Z0-9]/.test(p)) score += 1;
    const labels = ['Rất yếu', 'Yếu', 'Trung bình', 'Mạnh', 'Rất mạnh'];
    return { score: Math.min(score, 4), label: labels[Math.min(score, 4)] };
  },
  normalizeLoginInput(input) {
    const identifier = str(input && input.identifier).trim();
    const password = str(input && input.password);
    if (!identifier) return bad('Vui lòng nhập tên đăng nhập hoặc mã nhân viên');
    if (/\s/.test(identifier)) return bad(C.MESSAGES_VI.INVALID_CREDENTIALS);
    if (!password) return bad('Vui lòng nhập mật khẩu');
    return ok({ identifier, password });
  },
  normalizeRegisterInput(input) {
    const src = input || {};
    const u = validators.normalizeUsername(src.username);
    if (!u.ok) return u;
    const e = validators.normalizeEmployeeId(src.employee_id);
    if (!e.ok) return e;
    const d = validators.normalizeDisplayName(src.display_name);
    if (!d.ok) return d;
    const p = validators.validatePassword(src.password);
    if (!p.ok) return p;
    return ok({ username: u.value, employee_id: e.value, display_name: d.value, password: p.value });
  },
  normalizeGroupName(raw) {
    const v = str(raw).normalize('NFC').replace(/\s+/g, ' ').trim();
    if (!v) return bad('Vui lòng nhập tên nhóm');
    if (Array.from(v).length > C.GROUP_NAME_MAX) return bad(`Tên nhóm tối đa ${C.GROUP_NAME_MAX} ký tự`);
    return ok(v);
  },
  normalizeMessageContent(raw, opts) {
    const v = str(raw).normalize('NFC').replace(/\r\n/g, '\n').trim();
    if (!v && !(opts && opts.allowEmpty)) return bad('Tin nhắn trống');
    return ok(v);
  },
  validateIpv4(raw) {
    const v = str(raw).trim();
    if (!re(C.IPV4_REGEX).test(v)) return bad('Địa chỉ IP không hợp lệ (ví dụ: 192.168.1.10)');
    return ok(v);
  },
  extractLinks(text) {
    const m = str(text).match(re(C.URL_REGEX));
    return m ? Array.from(new Set(m)) : [];
  },
};

/** Port của shared/vectorClock.compareMessages (rút gọn) */
function compareMessages(a, b) {
  if (a.server_id != null && b.server_id != null) return a.server_id - b.server_id;
  const ta = a.created_at_local || a.created_at || '';
  const tb = b.created_at_local || b.created_at || '';
  if (ta !== tb) return ta < tb ? -1 : 1;
  return (Number(a.sender_id) || 0) - (Number(b.sender_id) || 0) || String(a.client_message_id).localeCompare(String(b.client_message_id));
}

// ───────────────────────── dữ liệu mẫu ─────────────────────────
const USERS = [
  { id: 1, username: 'an.nv', employee_id: 'NV001', display_name: 'Nguyễn Văn An', avatar: null, role: 'manager', online: true },
  { id: 2, username: 'binh.tt', employee_id: 'NV002', display_name: 'Trần Thị Bình', avatar: 'binh.webp', role: 'member', online: true },
  { id: 3, username: 'cuong.lv', employee_id: 'NV003', display_name: 'Lê Văn Cường', avatar: null, role: 'member', online: false },
  { id: 4, username: 'dung.pt', employee_id: 'NV004', display_name: 'Phạm Thu Dung', avatar: 'dung.webp', role: 'member', online: true },
  { id: 5, username: 'em.hv', employee_id: 'NV005', display_name: 'Hoàng Văn Em', avatar: null, role: 'member', online: false },
  { id: 6, username: 'giang.dt', employee_id: 'KT010', display_name: 'Đỗ Thị Giang', avatar: null, role: 'member', online: true },
  { id: 7, username: 'hai.nm', employee_id: 'KT011', display_name: 'Ngô Minh Hải', avatar: null, role: 'member', online: false },
];

const TEXTS = [
  'Chào mọi người, sáng nay họp lúc 9h nhé.',
  'Ok anh 👍',
  'Báo cáo tháng 10 em gửi trong nhóm rồi ạ.',
  'Mọi người xem giúp tài liệu quy trình mới ở http://192.168.1.5/wiki/quy-trinh',
  'Chiều nay ai rảnh hỗ trợ phòng kế toán cài máy in không?',
  'Em xin phép về sớm 30 phút hôm nay.',
  'Đã nhận, cảm ơn chị!',
  'Dòng rất dài để kiểm tra xuống dòng: Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.',
  'TênFileRấtDàiKhôngCóKhoảngTrắngĐểKiểmTraOverflowWrapAnywhere_BaoCaoTongHopQuy3_2026_ban_cuoi_cung_final_v2.xlsx',
  'Nhiều dòng:\n- Ý 1\n- Ý 2\n- Ý 3',
  'Haha 😂😂',
  'Tuần sau team building ở Ba Vì nha mọi người 🎉',
];

let localIdSeq = 1;
let serverIdSeq = 2000;

function makeMessage(conversationId, i, overrides) {
  const base = {
    local_id: localIdSeq++,
    server_id: null,
    client_message_id: uuid(),
    conversation_id: conversationId,
    sender_id: 2,
    type: 'text',
    content: TEXTS[i % TEXTS.length],
    reply_to: null,
    file: null,
    mentions: [],
    edited: false,
    recalled: false,
    vector_clock: {},
    created_at: null,
    created_at_local: null,
    updated_at: null,
    status: 'sent',
    sync_state: 'synced',
    local_path: null,
    p2p_receipts: null,
  };
  return { ...base, ...overrides };
}

function makeImageFile(seed, name, w = 1200, h = 800) {
  return { id: Math.floor(Math.random() * 1e6), sha256: `sha-${seed}`, name, size: 245000 + w * 10, mime_type: 'image/png', has_thumb: true, width: w, height: h };
}

function buildGroupMessages(conversationId, memberIds, count, startMinutesAgo) {
  const list = [];
  const start = Date.now() - startMinutesAgo * 60000;
  const step = (startMinutesAgo * 60000) / count;
  list.push(
    makeMessage(conversationId, 0, {
      type: 'system',
      content: 'Nguyễn Văn An đã tạo nhóm',
      sender_id: ME_ID,
      server_id: serverIdSeq++,
      created_at: new Date(start - 60000).toISOString(),
    }),
  );
  for (let i = 0; i < count; i += 1) {
    const sender = memberIds[(i * 7 + 3) % memberIds.length];
    const created = new Date(start + i * step).toISOString();
    const msg = makeMessage(conversationId, i, { sender_id: sender, server_id: serverIdSeq++, created_at: created });
    if (i % 10 === 4) {
      msg.type = 'image';
      msg.file = makeImageFile(`${conversationId}-${i}`, `anh-${i}.png`, i % 20 === 4 ? 800 : 1200, i % 20 === 4 ? 1200 : 800);
      msg.content = i % 20 === 4 ? 'Ảnh chụp bảng trắng buổi họp' : '';
    } else if (i % 17 === 8) {
      msg.type = 'file';
      msg.content = '';
      msg.file = { id: 500 + i, sha256: `file-${i}`, name: i % 34 === 8 ? 'BaoCaoQuy3.xlsx' : 'HuongDanSuDung.pdf', size: 1536000 + i * 1000, mime_type: 'application/pdf', has_thumb: false, width: null, height: null };
    }
    if (i % 13 === 6 && list.length > 3) msg.reply_to = list[list.length - 3].client_message_id;
    if (i % 19 === 11) {
      msg.content = `@Nguyễn Văn An anh duyệt giúp em đề xuất này với ạ`;
      msg.mentions = [ME_ID];
    }
    if (i % 23 === 5) msg.edited = true;
    if (i % 29 === 9) {
      msg.recalled = true;
      msg.content = '';
      msg.file = null;
      msg.type = 'text';
    }
    list.push(msg);
  }
  return list;
}

function buildDirect(conversationId, otherId, count) {
  const list = [];
  const start = Date.now() - 3 * 3600000;
  for (let i = 0; i < count; i += 1) {
    list.push(
      makeMessage(conversationId, i + 1, {
        sender_id: i % 2 === 0 ? otherId : ME_ID,
        server_id: serverIdSeq++,
        created_at: new Date(start + i * 600000).toISOString(),
      }),
    );
  }
  return list;
}

function createState() {
  localIdSeq = 1;
  serverIdSeq = 2000;
  const messages = new Map();
  const groupMsgs = buildGroupMessages('2', [1, 2, 3, 4, 5], 120, 3 * 24 * 60);
  const directMsgs = buildDirect('1', 2, 16);
  const clubMsgs = buildGroupMessages('3', [1, 4, 6, 7], 6, 120);
  const direct3 = buildDirect('4', 3, 4);
  // Tin offline minh họa trạng thái Mức 3
  direct3.push(makeMessage('4', 2, { sender_id: ME_ID, content: 'Tin gửi khi server offline — chờ Cường online (pending_peer)', status: 'pending', sync_state: 'pending_peer', created_at_local: nowIso() }));
  direct3.push(makeMessage('4', 3, { sender_id: ME_ID, content: 'Tin đã tới máy Cường qua P2P, chờ đẩy lên server (pending_server)', status: 'sent', sync_state: 'pending_server', created_at_local: nowIso() }));
  direct3.push(makeMessage('4', 4, { sender_id: ME_ID, content: 'Tin gửi lỗi — bấm dấu ! để gửi lại', status: 'failed', sync_state: 'pending_server', created_at_local: nowIso() }));
  clubMsgs.push(makeMessage('3', 5, { sender_id: ME_ID, content: 'Mới tới được một phần thành viên (partial_peer)', status: 'pending', sync_state: 'partial_peer', created_at_local: nowIso() }));
  messages.set('1', directMsgs);
  messages.set('2', groupMsgs);
  messages.set('3', clubMsgs);
  messages.set('4', direct3);

  const lastServerId = (list) => list.filter((m) => m.server_id).slice(-1)[0]?.server_id || 0;
  const gLast = lastServerId(groupMsgs);
  const dLast = lastServerId(directMsgs);
  const pinnedA = groupMsgs[20];
  const pinnedB = groupMsgs[60];
  const conversations = new Map();
  conversations.set('1', {
    id: '1', type: 'direct', name: null, owner_id: null, version: 1, client_temp_id: null,
    created_at: directMsgs[0].created_at, updated_at: nowIso(),
    members: [
      { user_id: 1, role: 'member', last_read_message_id: dLast, last_delivered_message_id: dLast },
      { user_id: 2, role: 'member', last_read_message_id: dLast - 1, last_delivered_message_id: dLast },
    ],
    pending_count: 0, pinned: [], unread_count: 1, sync_state: 'synced', my_role: 'member',
  });
  conversations.set('2', {
    id: '2', type: 'group', name: 'Phòng Kỹ thuật', owner_id: 1, version: 1, client_temp_id: null,
    created_at: groupMsgs[0].created_at, updated_at: nowIso(),
    members: [
      { user_id: 1, role: 'owner', last_read_message_id: gLast, last_delivered_message_id: gLast },
      { user_id: 2, role: 'admin', last_read_message_id: gLast, last_delivered_message_id: gLast },
      { user_id: 3, role: 'member', last_read_message_id: gLast - 5, last_delivered_message_id: gLast },
      { user_id: 4, role: 'member', last_read_message_id: gLast, last_delivered_message_id: gLast },
      { user_id: 5, role: 'member', last_read_message_id: gLast - 20, last_delivered_message_id: gLast - 2 },
    ],
    pending_count: 2,
    pinned: [pinnedA, pinnedB].map((m) => ({ client_message_id: m.client_message_id, server_id: m.server_id, sender_id: m.sender_id, content_preview: m.content || '🖼️ Hình ảnh', type: m.type, pinned_by: 1, pinned_at: nowIso() })),
    unread_count: 5, sync_state: 'synced', my_role: 'owner',
  });
  conversations.set('3', {
    id: '3', type: 'group', name: 'CLB Bóng đá ⚽', owner_id: 4, version: 1, client_temp_id: null,
    created_at: clubMsgs[0].created_at, updated_at: nowIso(),
    members: [
      { user_id: 4, role: 'owner', last_read_message_id: 0, last_delivered_message_id: 0 },
      { user_id: 1, role: 'member', last_read_message_id: 0, last_delivered_message_id: 0 },
      { user_id: 6, role: 'admin', last_read_message_id: 0, last_delivered_message_id: 0 },
      { user_id: 7, role: 'member', last_read_message_id: 0, last_delivered_message_id: 0 },
    ],
    pending_count: 0, pinned: [], unread_count: 0, sync_state: 'synced', my_role: 'member',
  });
  conversations.set('4', {
    id: '4', type: 'direct', name: null, owner_id: null, version: 1, client_temp_id: null,
    created_at: direct3[0].created_at, updated_at: nowIso(),
    members: [
      { user_id: 1, role: 'member', last_read_message_id: 0, last_delivered_message_id: 0 },
      { user_id: 3, role: 'member', last_read_message_id: lastServerId(direct3), last_delivered_message_id: lastServerId(direct3) },
    ],
    pending_count: 0, pinned: [], unread_count: 0, sync_state: 'synced', my_role: 'member',
  });
  return {
    me: null,
    users: new Map(USERS.map((u) => [u.id, clone(u)])),
    conversations,
    messages,
    pendingRequests: new Map([['2', [{ user_id: 6, requested_by: 3, created_at: nowIso() }, { user_id: 7, requested_by: 4, created_at: nowIso() }]]]),
    connection: 'online',
    settings: { theme: null, [`ui.last_server`]: null },
    autoStart: false,
    blocked: [{ ip: '192.168.1.99', reason: 'Máy lạ trong mạng', blocked_by: 1, created_at: nowIso() }],
    downloadedPaths: new Set(),
    uploads: new Map(),
    olderLoaded: new Set(),
  };
}

// ───────────────────────── cài đặt mock ─────────────────────────
export function installMockApi() {
  const state = createState();
  const listeners = new Map();

  const emit = (channel, payload) => {
    const set = listeners.get(channel);
    if (!set) return;
    setTimeout(() => set.forEach((cb) => cb(clone(payload))), 0);
  };
  const resolve = (value) => delay(80).then(() => clone(value));
  const isOnline = () => state.connection === 'online';
  const requireOnline = () => (isOnline() ? null : fail(C.ERROR_CODE.SERVER_OFFLINE, 'Máy chủ đang offline — thao tác này cần kết nối server'));
  const requireLogin = () => (state.me ? null : fail(C.ERROR_CODE.UNAUTHORIZED, 'Chưa đăng nhập'));

  const conv = (id) => state.conversations.get(String(id));
  const msgs = (id) => state.messages.get(String(id)) || [];
  const findMsg = (conversationId, cmid) => msgs(conversationId).find((m) => m.client_message_id === cmid);
  const userObj = (id) => state.users.get(Number(id));

  /** Gắn last_message + last_message_at cho LocalConversation */
  const withLast = (c) => {
    const list = msgs(c.id);
    const last = list[list.length - 1] || null;
    return { ...c, last_message: last, last_message_at: last ? last.created_at || last.created_at_local : c.updated_at };
  };
  const emitConversation = (id) => conv(id) && emit(EV.CONVERSATION, { conversation: withLast(conv(id)) });
  const emitMessage = (m) => emit(EV.MESSAGE, { message: m });

  const pushMessage = (m) => {
    const list = state.messages.get(String(m.conversation_id)) || [];
    list.push(m);
    state.messages.set(String(m.conversation_id), list);
    emitMessage(m);
    emitConversation(m.conversation_id);
  };

  /** Server xác nhận tin: gán server_id, rồi giả lập đã nhận / đã đọc */
  const confirmByServer = (m, { simulateRead = true } = {}) => {
    m.server_id = serverIdSeq++;
    m.created_at = nowIso();
    m.status = 'sent';
    m.sync_state = 'synced';
    emitMessage(m);
    emitConversation(m.conversation_id);
    if (!simulateRead) return;
    const c = conv(m.conversation_id);
    const others = c.members.filter((x) => x.user_id !== ME_ID);
    setTimeout(() => {
      others.forEach((x) => {
        if (!userObj(x.user_id)?.online) return;
        x.last_delivered_message_id = Math.max(x.last_delivered_message_id, m.server_id);
        emit(EV.STATUS, { conversation_id: c.id, user_id: x.user_id, last_delivered_message_id: x.last_delivered_message_id, last_read_message_id: x.last_read_message_id });
      });
    }, 900);
    setTimeout(() => {
      others.slice(0, 3).forEach((x) => {
        if (!userObj(x.user_id)?.online) return;
        x.last_read_message_id = Math.max(x.last_read_message_id, m.server_id);
        emit(EV.STATUS, { conversation_id: c.id, user_id: x.user_id, last_delivered_message_id: x.last_delivered_message_id, last_read_message_id: x.last_read_message_id });
      });
    }, 2400);
  };

  /** Người khác nhắn tới (kèm typing trước đó) */
  const incoming = (conversationId, senderId, content) => {
    const c = conv(conversationId);
    if (!c) return;
    const sender = userObj(senderId);
    emit(EV.TYPING, { conversation_id: c.id, user_id: senderId, display_name: sender.display_name });
    setTimeout(() => {
      const m = makeMessage(c.id, 0, { sender_id: senderId, content, server_id: isOnline() ? serverIdSeq++ : null, created_at: isOnline() ? nowIso() : null, created_at_local: nowIso(), sync_state: isOnline() ? 'synced' : 'peer_synced' });
      c.unread_count = (c.unread_count || 0) + 1;
      pushMessage(m);
    }, 1800);
  };

  const setConnection = (online) => {
    state.connection = online ? 'online' : 'offline_p2p';
    emit(EV.CONNECTION, { state: state.connection, server: { host: '192.168.1.5', port: 5001 }, serverOnline: online });
    if (online) runSync();
    updatePanel();
  };

  /** Giả lập đồng bộ khi server online lại */
  const runSync = async () => {
    const pending = [];
    state.messages.forEach((list) => list.forEach((m) => m.server_id == null && m.sender_id === ME_ID && m.status !== 'failed' && pending.push(m)));
    const total = Math.max(pending.length, 1);
    for (let i = 0; i <= pending.length; i += 1) {
      emit(EV.SYNC_PROGRESS, { phase: 'messages', done: i, total });
      await delay(400);
      if (pending[i]) confirmByServer(pending[i], { simulateRead: false });
    }
    emit(EV.SYNC_DONE, { messages: pending.length, files: 0, conflicts: 0 });
  };

  /** Trang tin: sort_key = local_id */
  const page = (list, before) => {
    const sorted = [...list].sort((a, b) => a.local_id - b.local_id);
    const filtered = before != null ? sorted.filter((m) => m.local_id < Number(before)) : sorted;
    const slice = filtered.slice(-C.PAGE_SIZE);
    return {
      messages: slice,
      has_more: filtered.length > slice.length,
      oldest_key: slice.length ? String(slice[0].local_id) : null,
    };
  };

  const loginResult = () => ({ user: state.me, settings: { theme: state.settings.theme || 'light' } });

  const api = {
    constants: clone(C),
    wsEvents: FALLBACK_WS_EVENTS,
    events: EV,
    groupActions: GA,
    fileProtocol: 'lcfile',
    validators,
    sortMessages: (list) => [...(list || [])].sort(compareMessages),
    on(channel, cb) {
      if (!Object.values(EV).includes(channel)) throw new Error(`Kênh event không hợp lệ: ${channel}`);
      if (!listeners.has(channel)) listeners.set(channel, new Set());
      listeners.get(channel).add(cb);
      return () => listeners.get(channel).delete(cb);
    },

    app: {
      getInfo: () => resolve({ version: '1.0.0-dev', platform: 'browser-mock', dataDir: 'D:\\LANChat\\data', logsDir: 'D:\\LANChat\\data\\logs', downloadsDir: 'D:\\LANChat\\data\\downloads', isPortable: true }),
      quit: () => resolve(true),
      getAutoStart: () => resolve(state.autoStart),
      setAutoStart: (enabled) => {
        state.autoStart = !!enabled;
        return resolve(true);
      },
      focusWindow: () => resolve(true),
    },

    discovery: {
      getServers: () => resolve([{ host: '192.168.1.5', port: 5001, server_name: 'LANChat Server (mock)', version: '1.0.0', last_seen: nowIso() }]),
      probe: () => delay(600).then(() => {
        emit(EV.SERVERS, [
          { host: '192.168.1.5', port: 5001, server_name: 'LANChat Server (mock)', version: '1.0.0', last_seen: nowIso() },
          { host: '192.168.1.20', port: 5001, server_name: 'Server dự phòng', version: '1.0.0', last_seen: nowIso() },
        ]);
        return true;
      }),
    },

    auth: {
      login: async (input) => {
        await delay(400);
        const id = fold(input.identifier);
        const user = Array.from(state.users.values()).find((u) => fold(u.username) === id || fold(u.employee_id) === id);
        if (!user || !input.password || input.password.length < C.PASSWORD_MIN) return fail(C.ERROR_CODE.INVALID_CREDENTIALS, C.MESSAGES_VI.INVALID_CREDENTIALS);
        if (user.id !== ME_ID) return fail(C.ERROR_CODE.INVALID_CREDENTIALS, 'Mock chỉ hỗ trợ đăng nhập tài khoản an.nv / NV001');
        state.me = state.users.get(ME_ID);
        try {
          if (input.remember) sessionStorage.setItem('lanchat-mock-session', '1');
        } catch (err) {
          console.warn('[mockApi] sessionStorage không khả dụng', err);
        }
        return clone(loginResult());
      },
      register: async (input) => {
        await delay(400);
        if (Array.from(state.users.values()).some((u) => fold(u.username) === fold(input.username))) return fail(C.ERROR_CODE.DUPLICATE, 'Tên đăng nhập đã tồn tại');
        state.me = state.users.get(ME_ID);
        return clone(loginResult());
      },
      logout: () => {
        state.me = null;
        try {
          sessionStorage.removeItem('lanchat-mock-session');
        } catch (err) {
          console.warn('[mockApi] sessionStorage không khả dụng', err);
        }
        return resolve(true);
      },
      restore: async () => {
        await delay(200);
        let remembered = false;
        try {
          remembered = sessionStorage.getItem('lanchat-mock-session') === '1';
        } catch (err) {
          console.warn('[mockApi] sessionStorage không khả dụng', err);
        }
        if (!remembered) return null;
        state.me = state.users.get(ME_ID);
        return clone({ ...loginResult(), server: { host: '192.168.1.5', port: 5001 } });
      },
      getState: () => resolve({ state: state.me ? 'logged_in' : 'logged_out', user: state.me, server: null, serverOnline: isOnline() }),
      changePassword: async ({ old_password: oldPw }) => {
        await delay(300);
        if (oldPw !== '123456') return fail(C.ERROR_CODE.INVALID_CREDENTIALS, 'Mật khẩu hiện tại không đúng (mock: 123456)');
        return { ok: true };
      },
    },

    socket: {
      request: () => requireOnline() || resolve({}),
      send: () => resolve(true),
      getStatus: () => resolve({ state: state.connection, server: { host: '192.168.1.5', port: 5001 }, serverOnline: isOnline() }),
    },

    db: {
      listConversations: () => requireLogin() || resolve(Array.from(state.conversations.values()).map(withLast)),
      getConversation: (id) => resolve(conv(id) ? withLast(conv(id)) : null),
      getMessages: (id, before) => resolve(page(msgs(id), before)),
      getMessagesAround: (id, cmid) => {
        const sorted = [...msgs(id)].sort((a, b) => a.local_id - b.local_id);
        const idx = sorted.findIndex((m) => m.client_message_id === cmid);
        if (idx < 0) return resolve({ messages: [], has_more: false, oldest_key: null });
        const start = Math.max(0, idx - 25);
        const slice = sorted.slice(start, idx + 25);
        return resolve({ messages: slice, has_more: start > 0, oldest_key: String(slice[0].local_id) });
      },
      searchMessages: (id, keyword) => {
        const k = fold(keyword);
        return resolve(msgs(id).filter((m) => !m.recalled && fold(m.content).includes(k)).reverse());
      },
      getMedia: (id, kind) => {
        const list = msgs(id).filter((m) => !m.recalled);
        if (kind === 'images') return resolve(list.filter((m) => m.type === 'image' && m.file).reverse());
        if (kind === 'files') return resolve(list.filter((m) => m.type === 'file' && m.file).reverse());
        return resolve(list.filter((m) => validators.extractLinks(m.content).length).reverse());
      },
      listUsers: () => resolve(Array.from(state.users.values())),
      getSetting: (key) => resolve(state.settings[key] ?? null),
      setSetting: (key, value) => {
        state.settings[key] = value;
        return resolve(true);
      },
    },

    chat: {
      sendText: async ({ conversation_id: cid, content, reply_to: replyTo, mentions }) => {
        const c = conv(cid);
        if (!c) return fail(C.ERROR_CODE.NOT_FOUND, 'Không tìm thấy cuộc trò chuyện');
        const peerOnline = c.members.some((x) => x.user_id !== ME_ID && userObj(x.user_id)?.online);
        const m = makeMessage(c.id, 0, {
          sender_id: ME_ID, content, reply_to: replyTo || null, mentions: mentions || [], status: 'pending',
          sync_state: isOnline() ? 'synced' : peerOnline ? 'pending_server' : 'pending_peer', created_at_local: nowIso(),
        });
        pushMessage(m);
        if (isOnline()) setTimeout(() => confirmByServer(m), PEER_DELAY_MS);
        else if (peerOnline) setTimeout(() => {
          m.status = 'sent';
          emitMessage(m);
        }, PEER_DELAY_MS);
        // 1-1 với Bình → tự trả lời để thử typing + tin đến
        if (c.type === 'direct' && c.members.some((x) => x.user_id === 2)) {
          setTimeout(() => incoming(c.id, 2, `Đã nhận: "${content.slice(0, 40)}" 👌`), 1500);
        }
        return clone(m);
      },
      sendFile: async (input) => {
        const c = conv(input.conversation_id);
        const isImage = !!input.as_image;
        const name = input.name || (input.path ? input.path.split(/[\\/]/).pop() : 'file.bin');
        const size = input.data ? input.data.byteLength : 3200000;
        const m = makeMessage(c.id, 0, {
          sender_id: ME_ID, type: isImage ? 'image' : 'file', content: input.content || '', status: 'pending',
          sync_state: 'synced', created_at_local: nowIso(), local_path: input.path || null,
          file: isImage
            ? makeImageFile(uuid(), name, 1000, 700)
            : { id: Math.floor(Math.random() * 1e6), sha256: `up-${uuid()}`, name, size, mime_type: input.mime_type || 'application/octet-stream', has_thumb: false, width: null, height: null },
        });
        if (input.path) state.downloadedPaths.add(input.path);
        pushMessage(m);
        let percent = 0;
        const timer = setInterval(() => {
          percent = Math.min(100, percent + 12);
          emit(EV.UPLOAD_PROGRESS, { client_message_id: m.client_message_id, percent, state: percent < 100 ? 'uploading' : 'done' });
          if (percent >= 100) {
            clearInterval(timer);
            state.uploads.delete(m.client_message_id);
            confirmByServer(m);
          }
        }, 350);
        state.uploads.set(m.client_message_id, timer);
        return clone(m);
      },
      cancelUpload: (cmid) => {
        clearInterval(state.uploads.get(cmid));
        state.uploads.delete(cmid);
        state.messages.forEach((list, cid) => {
          const idx = list.findIndex((m) => m.client_message_id === cmid);
          if (idx >= 0) {
            list.splice(idx, 1);
            emit(EV.UPLOAD_PROGRESS, { client_message_id: cmid, percent: 0, state: 'cancelled' });
            emit(EV.MESSAGE_REMOVED, { conversation_id: cid, client_message_id: cmid });
            emitConversation(cid);
          }
        });
        return resolve(true);
      },
      retry: (cmid) => {
        state.messages.forEach((list) => {
          const m = list.find((x) => x.client_message_id === cmid);
          if (!m) return;
          m.status = 'pending';
          m.sync_state = isOnline() ? 'synced' : 'pending_peer';
          emitMessage(m);
          if (isOnline()) setTimeout(() => confirmByServer(m), PEER_DELAY_MS);
        });
        return resolve(true);
      },
      edit: (cid, cmid, content) => {
        const m = findMsg(cid, cmid);
        if (!m || m.sender_id !== ME_ID) return fail(C.ERROR_CODE.FORBIDDEN, 'Bạn chỉ sửa được tin của mình');
        Object.assign(m, { content, edited: true, updated_at: nowIso() });
        emitMessage(m);
        emitConversation(cid);
        return resolve(true);
      },
      recall: (cid, cmid) => {
        const m = findMsg(cid, cmid);
        if (!m) return fail(C.ERROR_CODE.NOT_FOUND, 'Không tìm thấy tin');
        Object.assign(m, { recalled: true, content: '', file: null, updated_at: nowIso() });
        emitMessage(m);
        emitConversation(cid);
        return resolve(true);
      },
      pin: (cid, cmid) => {
        const c = conv(cid);
        const m = findMsg(cid, cmid);
        if (c.type === 'group' && !['owner', 'admin'].includes(c.my_role)) return fail(C.ERROR_CODE.FORBIDDEN, 'Chỉ trưởng/phó nhóm được ghim tin');
        if (!c.pinned.some((p) => p.client_message_id === cmid)) {
          c.pinned.unshift({ client_message_id: cmid, server_id: m.server_id, sender_id: m.sender_id, content_preview: m.content || (m.file ? m.file.name : ''), type: m.type, pinned_by: ME_ID, pinned_at: nowIso() });
        }
        emit(EV.PINNED, { conversation_id: c.id, pinned: c.pinned });
        return resolve(true);
      },
      unpin: (cid, cmid) => {
        const c = conv(cid);
        c.pinned = c.pinned.filter((p) => p.client_message_id !== cmid);
        emit(EV.PINNED, { conversation_id: c.id, pinned: c.pinned });
        return resolve(true);
      },
      markRead: (cid) => {
        const c = conv(cid);
        if (c && c.unread_count) {
          c.unread_count = 0;
          emitConversation(cid);
        }
        return resolve(true);
      },
      typing: () => resolve(true),
      openDirect: (userId) => {
        let c = Array.from(state.conversations.values()).find((x) => x.type === 'direct' && x.members.some((mm) => mm.user_id === Number(userId)));
        if (!c) {
          const id = String(state.conversations.size + 10);
          c = { id, type: 'direct', name: null, owner_id: null, version: 1, client_temp_id: null, created_at: nowIso(), updated_at: nowIso(), members: [{ user_id: ME_ID, role: 'member', last_read_message_id: 0, last_delivered_message_id: 0 }, { user_id: Number(userId), role: 'member', last_read_message_id: 0, last_delivered_message_id: 0 }], pending_count: 0, pinned: [], unread_count: 0, sync_state: 'synced', my_role: 'member' };
          state.conversations.set(id, c);
          state.messages.set(id, []);
        }
        return resolve(withLast(c));
      },
      createGroup: (name, memberIds) => {
        const id = isOnline() ? String(100 + state.conversations.size) : `temp-${uuid()}`;
        const c = { id, type: 'group', name, owner_id: ME_ID, version: 1, client_temp_id: null, created_at: nowIso(), updated_at: nowIso(), members: [{ user_id: ME_ID, role: 'owner', last_read_message_id: 0, last_delivered_message_id: 0 }, ...memberIds.map((uid) => ({ user_id: uid, role: 'member', last_read_message_id: 0, last_delivered_message_id: 0 }))], pending_count: 0, pinned: [], unread_count: 0, sync_state: isOnline() ? 'synced' : 'pending_server', my_role: 'owner' };
        state.conversations.set(id, c);
        state.messages.set(id, [makeMessage(id, 0, { type: 'system', content: `${state.me.display_name} đã tạo nhóm`, sender_id: ME_ID, server_id: serverIdSeq++, created_at: nowIso() })]);
        return resolve(withLast(c));
      },
      renameGroup: (cid, name) => {
        const c = conv(cid);
        c.name = name;
        c.version += 1;
        pushMessage(makeMessage(cid, 0, { type: 'system', content: `${state.me.display_name} đã đổi tên nhóm thành "${name}"`, sender_id: ME_ID, server_id: serverIdSeq++, created_at: nowIso() }));
        return resolve(true);
      },
      groupAction: async (action, data) => {
        const offline = requireOnline();
        if (offline) return offline;
        await delay(150);
        const c = conv(data.conversation_id);
        const pending = state.pendingRequests.get(c.id) || [];
        const canManage = ['owner', 'admin'].includes(c.my_role);
        switch (action) {
          case GA.ADD_MEMBER: {
            if (canManage) {
              data.user_ids.forEach((uid) => c.members.push({ user_id: uid, role: 'member', last_read_message_id: 0, last_delivered_message_id: 0 }));
              emitConversation(c.id);
              return { added: data.user_ids, pending: [] };
            }
            state.pendingRequests.set(c.id, [...pending, ...data.user_ids.map((uid) => ({ user_id: uid, requested_by: ME_ID, created_at: nowIso() }))]);
            return { added: [], pending: data.user_ids };
          }
          case GA.APPROVE_MEMBER:
          case GA.REJECT_MEMBER: {
            state.pendingRequests.set(c.id, pending.filter((p) => p.user_id !== data.user_id));
            if (action === GA.APPROVE_MEMBER) c.members.push({ user_id: data.user_id, role: 'member', last_read_message_id: 0, last_delivered_message_id: 0 });
            c.pending_count = state.pendingRequests.get(c.id).length;
            emitConversation(c.id);
            emit(EV.PENDING, { conversation_id: c.id, pending_count: c.pending_count });
            return {};
          }
          case GA.REMOVE_MEMBER:
            c.members = c.members.filter((m) => m.user_id !== data.user_id);
            emitConversation(c.id);
            return {};
          case GA.SET_ADMIN:
            c.members = c.members.map((m) => (m.user_id === data.user_id ? { ...m, role: data.is_admin ? 'admin' : 'member' } : m));
            emitConversation(c.id);
            return {};
          case GA.DELETE:
            state.conversations.delete(c.id);
            emit(EV.CONVERSATION_REMOVED, { conversation_id: c.id });
            return {};
          case GA.REQUEST_PENDING:
            return { conversation_id: c.id, pending: clone(pending) };
          default:
            return fail(C.ERROR_CODE.VALIDATION, 'Hành động không hợp lệ');
        }
      },
      loadOlderFromServer: async (cid) => {
        await delay(500);
        // Giả lập server còn 30 tin cũ hơn cho nhóm "Phòng Kỹ thuật" (1 lần)
        if (String(cid) !== '2' || state.olderLoaded.has('2')) return { count: 0, has_more: false };
        state.olderLoaded.add('2');
        const list = msgs('2');
        const oldestTime = new Date(list[0].created_at).getTime();
        const older = [];
        for (let i = 0; i < 30; i += 1) {
          older.push(makeMessage('2', i, { sender_id: [2, 3, 4][i % 3], server_id: 1000 + i, created_at: new Date(oldestTime - (30 - i) * 3600000).toISOString(), local_id: -100 + i }));
        }
        state.messages.set('2', [...older, ...list]);
        return { count: older.length, has_more: false };
      },
    },

    profile: {
      update: (displayName) => {
        state.me.display_name = displayName;
        emit(EV.USERS, { users: [state.me] });
        return resolve({ user: state.me });
      },
      uploadAvatar: () => {
        state.me.avatar = `me-${Date.now()}.webp`;
        emit(EV.USERS, { users: [state.me] });
        return delay(600).then(() => clone({ user: state.me }));
      },
      setTheme: (theme) => {
        state.settings.theme = theme;
        return resolve(true);
      },
    },

    file: {
      pick: () => resolve([
        { path: 'C:\\Users\\an\\Documents\\BaoCaoThang10.xlsx', name: 'BaoCaoThang10.xlsx', size: 845000, mime_type: 'application/vnd.ms-excel' },
        { path: 'C:\\Users\\an\\Pictures\\so-do-mang.png', name: 'so-do-mang.png', size: 420000, mime_type: 'image/png' },
      ]),
      pickImage: () => resolve([{ path: 'C:\\Users\\an\\Pictures\\avatar.png', name: 'avatar.png', size: 120000, mime_type: 'image/png' }]),
      getPathForFile: () => '',
      download: async ({ client_message_id: cmid, file }) => {
        await delay(300);
        const downloadId = uuid();
        const localPath = `D:\\LANChat\\data\\downloads\\${file.name}`;
        let percent = 0;
        const timer = setInterval(() => {
          percent = Math.min(100, percent + 10);
          const done = percent >= 100;
          if (done) {
            clearInterval(timer);
            state.downloadedPaths.add(localPath);
          }
          emit(EV.DOWNLOAD_PROGRESS, { download_id: downloadId, client_message_id: cmid, percent, state: done ? 'done' : 'downloading', local_path: done ? localPath : undefined });
        }, 250);
        state.uploads.set(downloadId, { timer, cmid });
        return { download_id: downloadId, local_path: localPath };
      },
      cancelDownload: (downloadId) => {
        const entry = state.uploads.get(downloadId);
        if (entry) {
          clearInterval(entry.timer);
          emit(EV.DOWNLOAD_PROGRESS, { download_id: downloadId, client_message_id: entry.cmid, percent: 0, state: 'cancelled' });
        }
        return resolve(true);
      },
      open: (p) => {
        console.info('[mockApi] Mở file', p);
        return resolve(true);
      },
      showInFolder: (p) => {
        console.info('[mockApi] Mở thư mục', p);
        return resolve(true);
      },
      exists: (p) => resolve(state.downloadedPaths.has(p)),
      saveImage: (sha, name) => resolve({ path: `D:\\LANChat\\data\\downloads\\${name}` }),
      thumbUrl: (sha) => svgDataUrl(sha, 400, 280, ''),
      imageUrl: (sha) => svgDataUrl(sha, 1200, 840, sha),
      avatarUrl: (name) => (name ? svgDataUrl(name, 128, 128, '') : ''),
    },

    logs: {
      write: () => resolve(true),
    },

    admin: {
      listBlocked: () => resolve({ blocked: state.blocked }),
      blockIp: (ip, reason) => {
        if (state.blocked.some((b) => b.ip === ip)) return fail(C.ERROR_CODE.CONFLICT, 'IP này đã bị chặn');
        state.blocked.unshift({ ip, reason, blocked_by: ME_ID, created_at: nowIso() });
        return resolve({ blocked: state.blocked[0], kicked_count: 1 });
      },
      unblockIp: (ip) => {
        state.blocked = state.blocked.filter((b) => b.ip !== ip);
        return resolve({ ip });
      },
    },

    dialog: {
      confirm: () => resolve(false),
      alert: () => resolve(true),
    },

    call: {
      signal: () => resolve(true),
    },
  };

  window.api = api;

  // ───────────── bảng điều khiển dev (DOM thuần, chỉ dev) ─────────────
  let panelButton = null;
  function updatePanel() {
    if (panelButton) panelButton.textContent = `Server: ${isOnline() ? 'ON' : 'OFF'}`;
  }
  const control = {
    setServerOnline: setConnection,
    incoming: (cid = '2', senderId = 4, text = 'Tin nhắn mới từ mock 📨') => incoming(cid, senderId, text),
    sync: runSync,
    state,
  };
  window.__lanchatMock = control;

  const mountPanel = () => {
    const box = document.createElement('div');
    box.setAttribute('data-dev-panel', '');
    box.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:9999;display:flex;gap:4px;font:11px Segoe UI,Arial;opacity:.85';
    const mk = (label, onClick) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.style.cssText = 'padding:3px 6px;border-radius:6px;border:1px solid #888;background:#111;color:#fff;cursor:pointer';
      b.addEventListener('click', onClick);
      box.appendChild(b);
      return b;
    };
    panelButton = mk('Server: ON', () => setConnection(!isOnline()));
    mk('Tin đến (nhóm)', () => control.incoming('2', 4, 'Mọi người ơi, có ai thấy cái sạc laptop của em không? 🔌'));
    mk('Tin đến (1-1)', () => control.incoming('1', 2, 'Anh ơi, chiều nay họp không ạ?'));
    document.body.appendChild(box);
  };
  if (document.body) mountPanel();
  else window.addEventListener('DOMContentLoaded', mountPanel);

  console.info('[mockApi] Đã cài window.api giả lập. Đăng nhập: "an.nv" / mật khẩu ≥ 6 ký tự.');
}
