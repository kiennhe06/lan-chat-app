/**
 * Preload — cầu nối IPC duy nhất giữa renderer (React) và main process.
 * Expose `window.api` qua contextBridge (contextIsolation: true, nodeIntegration: false).
 *
 * Quy ước:
 * - Mọi hàm invoke trả Promise<data>. Main trả envelope { ok, data } | { ok:false, error:{code,message} };
 *   preload unwrap: thành công → resolve(data); thất bại → reject(plain object {code, message}).
 *   (Dùng plain object thay vì Error để giữ nguyên `code` khi đi qua contextBridge.)
 * - `api.on(channel, cb)` đăng ký push event từ main, trả hàm hủy đăng ký.
 * - Component React KHÔNG gọi window.api trực tiếp — chỉ hooks mới gọi.
 *
 * Đây là NGUỒN SỰ THẬT của hợp đồng IPC — main (ipc/*.js) phải implement đúng các kênh này.
 */
'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');
const constants = require('../shared/constants');
const wsEvents = require('../shared/wsEvents');
const validators = require('../shared/validators');
const vectorClock = require('../shared/vectorClock');
const { IPC_INVOKE: I, IPC_EVENTS, GROUP_ACTION, FILE_PROTOCOL } = require('../ipc/channels');

/**
 * Gọi main và unwrap envelope.
 * @param {string} channel
 * @param {any} [payload]
 */
async function call(channel, payload) {
  let res;
  try {
    res = await ipcRenderer.invoke(channel, payload);
  } catch (err) {
    // Lỗi IPC ở tầng Electron (handler chưa đăng ký, crash...)
    throw { code: constants.ERROR_CODE.INTERNAL, message: (err && err.message) || 'Lỗi IPC' };
  }
  if (res && res.ok) return res.data;
  const error = (res && res.error) || {};
  throw { code: error.code || constants.ERROR_CODE.INTERNAL, message: error.message || 'Đã xảy ra lỗi' };
}

const ALLOWED_EVENT_CHANNELS = new Set(Object.values(IPC_EVENTS));

/**
 * Đăng ký push event từ main.
 * @param {string} channel một giá trị trong IPC_EVENTS
 * @param {(payload:any)=>void} callback
 * @returns {() => void} hủy đăng ký
 */
function on(channel, callback) {
  if (!ALLOWED_EVENT_CHANNELS.has(channel)) {
    throw new Error(`Kênh event không hợp lệ: ${channel}`);
  }
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

// RegExp không clone được qua contextBridge → chuyển sang {source, flags}
const serializableConstants = JSON.parse(
  JSON.stringify(constants, (_key, value) => (value instanceof RegExp ? { source: value.source, flags: value.flags } : value)),
);

const api = {
  /** Hằng số & tên event dùng chung (read-only) */
  constants: serializableConstants,
  wsEvents,
  events: IPC_EVENTS,
  groupActions: GROUP_ACTION,
  fileProtocol: FILE_PROTOCOL,

  /** Hàm validate/normalize thuần (chạy trong preload, trả plain object) */
  validators: {
    normalizeUsername: (v) => validators.normalizeUsername(v),
    normalizeEmployeeId: (v) => validators.normalizeEmployeeId(v),
    normalizeDisplayName: (v) => validators.normalizeDisplayName(v),
    validatePassword: (v) => validators.validatePassword(v),
    passwordStrength: (v) => validators.passwordStrength(v),
    normalizeLoginInput: (v) => validators.normalizeLoginInput(v),
    normalizeRegisterInput: (v) => validators.normalizeRegisterInput(v),
    normalizeGroupName: (v) => validators.normalizeGroupName(v),
    normalizeMessageContent: (v, opts) => validators.normalizeMessageContent(v, opts),
    validateIpv4: (v) => validators.validateIpv4(v),
    extractLinks: (v) => validators.extractLinks(v),
  },

  /** Sắp xếp tin theo (server_id → nhân quả → tie-breaker). Trả mảng MỚI. */
  sortMessages: (messages) => [...(messages || [])].sort(vectorClock.compareMessages),

  on,

  app: {
    /** @returns {Promise<{version, platform, dataDir, logsDir, downloadsDir, isPortable}>} */
    getInfo: () => call(I.APP_GET_INFO),
    quit: () => call(I.APP_QUIT),
    /** Auto-start qua shortcut trong shell:startup (Windows, không registry) */
    getAutoStart: () => call(I.APP_GET_AUTOSTART),
    setAutoStart: (enabled) => call(I.APP_SET_AUTOSTART, { enabled: !!enabled }),
    focusWindow: () => call(I.WINDOW_FOCUS),
  },

  discovery: {
    /** @returns {Promise<Array<{host, port, server_name, version, last_seen}>>} */
    getServers: () => call(I.DISCOVERY_GET_SERVERS),
    /** Gửi gói probe broadcast để server trả lời ngay */
    probe: () => call(I.DISCOVERY_PROBE),
  },

  auth: {
    /**
     * @param {{host:string, port?:number, identifier:string, password:string, remember:boolean}} input
     * @returns {Promise<{user, settings}>}
     */
    login: (input) => call(I.AUTH_LOGIN, input),
    /**
     * @param {{host, port?, username, employee_id, display_name, password, remember}} input
     * @returns {Promise<{user, settings}>}
     */
    register: (input) => call(I.AUTH_REGISTER, input),
    logout: () => call(I.AUTH_LOGOUT),
    /**
     * Khôi phục phiên đã "Ghi nhớ đăng nhập" (token trong client.db). Nếu server offline mà token còn hạn
     * → vào chế độ P2P offline. @returns {Promise<{user, settings, server} | null>}
     */
    restore: () => call(I.AUTH_RESTORE),
    /** @returns {Promise<{state, user, server, serverOnline}>} */
    getState: () => call(I.AUTH_GET_STATE),
    /** @param {{old_password, new_password}} input */
    changePassword: (input) => call(I.AUTH_CHANGE_PASSWORD, input),
  },

  socket: {
    /** Request/response tới server (reject SERVER_OFFLINE nếu đang offline) */
    request: (type, data) => call(I.SOCKET_REQUEST, { type, data }),
    /** Gửi một chiều (fire-and-forget) */
    send: (type, data) => call(I.SOCKET_SEND, { type, data }),
    /** @returns {Promise<{state, server, serverOnline}>} */
    getStatus: () => call(I.SOCKET_GET_STATUS),
  },

  db: {
    /** @returns {Promise<LocalConversation[]>} sắp theo last_message_at giảm dần */
    listConversations: () => call(I.DB_LIST_CONVERSATIONS),
    getConversation: (conversationId) => call(I.DB_GET_CONVERSATION, { conversation_id: conversationId }),
    /**
     * Lịch sử local, phân trang PAGE_SIZE. `before` = sort_key của tin cũ nhất đang hiển thị (null = trang mới nhất).
     * @returns {Promise<{messages: LocalMessage[] (tăng dần), has_more: boolean, oldest_key: string|null}>}
     */
    getMessages: (conversationId, before) => call(I.DB_GET_MESSAGES, { conversation_id: conversationId, before: before || null }),
    /** Tải cửa sổ quanh 1 tin (dùng khi click reply/search/pin tới tin chưa load) */
    getMessagesAround: (conversationId, clientMessageId) =>
      call(I.DB_GET_MESSAGES_AROUND, { conversation_id: conversationId, client_message_id: clientMessageId }),
    /** @returns {Promise<LocalMessage[]>} */
    searchMessages: (conversationId, keyword) => call(I.DB_SEARCH_MESSAGES, { conversation_id: conversationId, keyword }),
    /** @param {'images'|'files'|'links'} kind @returns {Promise<Array>} */
    getMedia: (conversationId, kind) => call(I.DB_GET_MEDIA, { conversation_id: conversationId, kind }),
    /** @returns {Promise<LocalUser[]>} */
    listUsers: () => call(I.DB_LIST_USERS),
    getSetting: (key) => call(I.DB_GET_SETTING, { key }),
    setSetting: (key, value) => call(I.DB_SET_SETTING, { key, value }),
  },

  chat: {
    /**
     * @param {{conversation_id, content, reply_to?, mentions?}} input
     * @returns {Promise<LocalMessage>} tin local (status pending) — cập nhật tiếp qua evt:message
     */
    sendText: (input) => call(I.CHAT_SEND_TEXT, input),
    /**
     * Gửi ảnh/file. Nguồn: `path` (file chọn từ đĩa) HOẶC `data` (ArrayBuffer — ảnh paste) + `name` + `mime_type`.
     * @param {{conversation_id, path?, data?: ArrayBuffer, name?, mime_type?, content?, reply_to?, as_image?: boolean}} input
     * @returns {Promise<LocalMessage>} progress qua evt:upload-progress
     */
    sendFile: (input) => call(I.CHAT_SEND_FILE, input),
    cancelUpload: (clientMessageId) => call(I.CHAT_CANCEL_UPLOAD, { client_message_id: clientMessageId }),
    retry: (clientMessageId) => call(I.CHAT_RETRY, { client_message_id: clientMessageId }),
    edit: (conversationId, clientMessageId, content) =>
      call(I.CHAT_EDIT, { conversation_id: conversationId, client_message_id: clientMessageId, content }),
    recall: (conversationId, clientMessageId) =>
      call(I.CHAT_RECALL, { conversation_id: conversationId, client_message_id: clientMessageId }),
    pin: (conversationId, clientMessageId) => call(I.CHAT_PIN, { conversation_id: conversationId, client_message_id: clientMessageId }),
    unpin: (conversationId, clientMessageId) =>
      call(I.CHAT_UNPIN, { conversation_id: conversationId, client_message_id: clientMessageId }),
    /** Đánh dấu đã đọc tới tin mới nhất + reset unread_count */
    markRead: (conversationId) => call(I.CHAT_MARK_READ, { conversation_id: conversationId }),
    typing: (conversationId) => call(I.CHAT_TYPING, { conversation_id: conversationId }),
    /** Mở (find-or-create) chat 1-1. @returns {Promise<LocalConversation>} */
    openDirect: (userId) => call(I.CHAT_OPEN_DIRECT, { user_id: userId }),
    /** Tạo nhóm (offline → id tạm temp-…). @returns {Promise<LocalConversation>} */
    createGroup: (name, memberIds) => call(I.CHAT_CREATE_GROUP, { name, member_ids: memberIds }),
    renameGroup: (conversationId, name) => call(I.CHAT_RENAME_GROUP, { conversation_id: conversationId, name }),
    /**
     * Hành động nhóm chỉ online: action ∈ groupActions.
     * @param {string} action
     * @param {{conversation_id, user_id?, user_ids?, is_admin?}} data
     */
    groupAction: (action, data) => call(I.CHAT_GROUP_ACTION, { action, data }),
    /** Kéo thêm lịch sử cũ từ server khi local hết (máy mới / cache trống). @returns {Promise<{count, has_more}>} */
    loadOlderFromServer: (conversationId) => call(I.CHAT_LOAD_OLDER_FROM_SERVER, { conversation_id: conversationId }),
  },

  profile: {
    update: (displayName) => call(I.PROFILE_UPDATE, { display_name: displayName }),
    /** @param {{path?: string, data?: ArrayBuffer, mime_type?: string}} input */
    uploadAvatar: (input) => call(I.PROFILE_UPLOAD_AVATAR, input),
    /** Lưu theme vào client.db (+ server nếu online) */
    setTheme: (theme) => call(I.PROFILE_SET_THEME, { theme }),
  },

  file: {
    /** Hộp thoại chọn nhiều file. @returns {Promise<Array<{path, name, size, mime_type}>>} */
    pick: () => call(I.FILE_PICK),
    pickImage: () => call(I.FILE_PICK_IMAGE),
    /** Đường dẫn thật của File (drag-drop / input file) */
    getPathForFile: (file) => {
      try {
        return webUtils.getPathForFile(file);
      } catch (_err) {
        return '';
      }
    },
    /**
     * Tải file: mở dialog.showSaveDialog → chọn chỗ lưu → tải có progress (evt:download-progress).
     * @param {{client_message_id, file: WireFile}} input
     * @returns {Promise<{download_id, local_path} | null>} null nếu người dùng hủy dialog
     */
    download: (input) => call(I.FILE_DOWNLOAD, input),
    cancelDownload: (downloadId) => call(I.FILE_CANCEL_DOWNLOAD, { download_id: downloadId }),
    open: (localPath) => call(I.FILE_OPEN, { path: localPath }),
    showInFolder: (localPath) => call(I.FILE_SHOW_IN_FOLDER, { path: localPath }),
    exists: (localPath) => call(I.FILE_EXISTS, { path: localPath }),
    /** Lưu ảnh đang xem trong lightbox (dialog chọn chỗ lưu) */
    saveImage: (sha256, name) => call(I.FILE_SAVE_IMAGE, { sha256, name }),
    /** URL hiển thị ảnh qua custom protocol (cache offline) */
    thumbUrl: (sha256) => `${FILE_PROTOCOL}://thumb/${sha256}`,
    imageUrl: (sha256) => `${FILE_PROTOCOL}://image/${sha256}`,
    avatarUrl: (name) => (name ? `${FILE_PROTOCOL}://avatar/${encodeURIComponent(name)}` : ''),
  },

  logs: {
    /** Ghi log client (local JSONL + ship lên server) */
    write: (level, category, action, meta) => call(I.LOG_WRITE, { level, category, action, meta }),
  },

  admin: {
    listBlocked: () => call(I.ADMIN_LIST_BLOCKED),
    blockIp: (ip, reason) => call(I.ADMIN_BLOCK_IP, { ip, reason }),
    unblockIp: (ip) => call(I.ADMIN_UNBLOCK_IP, { ip }),
  },

  dialog: {
    /** Hộp thoại native (dùng cho cuộc gọi đến, tránh focus trap). @returns {Promise<boolean>} */
    confirm: (options) => call(I.DIALOG_CONFIRM, options),
    alert: (options) => call(I.DIALOG_ALERT, options),
  },

  call: {
    /** Gửi tín hiệu WebRTC (tạm tắt) */
    signal: (type, data) => call(I.CALL_SIGNAL, { type, data }),
  },
};

contextBridge.exposeInMainWorld('api', api);
