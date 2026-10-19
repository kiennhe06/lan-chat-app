/**
 * Hằng số dùng chung giữa SERVER và CLIENT.
 *
 * ⚠️ File này được DUPLICATE ở:
 *   - be/src/shared/constants.js       (bản gốc)
 *   - fe/shared/constants.js           (bản copy)
 * Khi sửa, chạy `npm run sync:shared` ở thư mục gốc để copy sang client.
 *
 * Chỉ chứa giá trị thuần (không import Node/Electron/React).
 */
'use strict';

const APP_NAME = 'LANChat';
const APP_VERSION = '1.1.0';

/** Cổng mạng mặc định — có thể override qua app-config.json */
const NETWORK = Object.freeze({
  SERVER_PORT: 5001, // HTTP + WebSocket server
  SERVER_DISCOVERY_PORT: 41234, // UDP broadcast server → client
  P2P_PORT: 5002, // WebSocket P2P giữa các client
  P2P_DISCOVERY_PORT: 5003, // UDP broadcast peer ↔ peer
  WS_PATH: '/ws',
  SERVER_BROADCAST_INTERVAL_MS: 3000,
  PEER_BROADCAST_INTERVAL_MS: 5000,
  PEER_MISS_LIMIT: 3, // miss 3 lần (15s) → xóa peer
  SERVER_STALE_MS: 10000, // không nghe broadcast server sau 10s → bỏ khỏi danh sách
  RECONNECT_MIN_MS: 1000,
  RECONNECT_MAX_MS: 15000,
  HEARTBEAT_INTERVAL_MS: 15000,
  REQUEST_TIMEOUT_MS: 15000,
});

/** UI */
const STATUS_ICON_SIZE = 16;
const MAX_GROUP_READER_AVATARS = 3;
const PAGE_SIZE = 50;
const TEXTAREA_MAX_HEIGHT = 120;
const TYPING_THROTTLE_MS = 1500;
const TYPING_HIDE_MS = 3000;
const HIGHLIGHT_DURATION_MS = 1500;
const REPLY_PREVIEW_MAX_CHARS = 200;
const PIN_PREVIEW_MAX_CHARS = 120;
const LIGHTBOX_ZOOM_MIN = 0.5;
const LIGHTBOX_ZOOM_MAX = 5;
const LIGHTBOX_ZOOM_STEP = 0.25;
const TOAST_DURATION_MS = 3000;
const SEARCH_RESULT_LIMIT = 100;
const MIN_GROUP_OTHER_MEMBERS = 2; // tạo nhóm cần ≥ 2 người khác ngoài mình

/** File */
const MAX_FILE_SIZE = 200 * 1024 * 1024; // 200MB
const MAX_AVATAR_SIZE = 10 * 1024 * 1024; // 10MB ảnh gốc trước khi resize
const AVATAR_SIZE_PX = 256;
const THUMB_MAX_PX = 400;
const P2P_CHUNK_SIZE = 512 * 1024; // 512KB
const IMAGE_MIME_PREFIX = 'image/';
const THUMBNAILABLE_MIME = Object.freeze(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp', 'image/tiff']);

/** Auth */
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 ngày
const USERNAME_MIN = 3;
const USERNAME_MAX = 30;
const EMPLOYEE_ID_MAX = 30;
const DISPLAY_NAME_MIN = 1;
const DISPLAY_NAME_MAX = 50;
const PASSWORD_MIN = 6;
const PASSWORD_MAX = 64;
const GROUP_NAME_MAX = 100;
const MESSAGE_MAX_LENGTH = 10000;
const BLOCK_REASON_MAX = 200;

// Regex dùng chung (renderer dùng qua validators — RegExp không clone được qua contextBridge)
const USERNAME_REGEX = /^[a-zA-Z0-9_.-]{3,30}$/;
const EMPLOYEE_ID_REGEX = /^[a-zA-Z0-9_.-]{1,30}$/;
const PASSWORD_ASCII_REGEX = /^[\x20-\x7E]+$/;
const IPV4_REGEX = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const URL_REGEX = /\bhttps?:\/\/[^\s<>"']+/gi;
const MENTION_TRIGGER = '@';

/** Trạng thái tin nhắn (chỉ tiến: pending → sent → delivered → read) */
const MESSAGE_STATUS = Object.freeze({
  PENDING: 'pending',
  SENT: 'sent',
  DELIVERED: 'delivered',
  READ: 'read',
  FAILED: 'failed',
});
const MESSAGE_STATUS_RANK = Object.freeze({ failed: -1, pending: 0, sent: 1, delivered: 2, read: 3 });

/** Trạng thái đồng bộ của tin/conversation ở client (Mức 3 offline-first) */
const SYNC_STATE = Object.freeze({
  SYNCED: 'synced', // server đã có
  PENDING_SERVER: 'pending_server', // peer đã nhận, chờ đẩy lên server
  PENDING_PEER: 'pending_peer', // chưa gửi được cho ai
  PARTIAL_PEER: 'partial_peer', // group: mới tới được một phần members
  PEER_SYNCED: 'peer_synced', // (phía nhận) nhận qua P2P, server chưa xác nhận
});

const MESSAGE_TYPE = Object.freeze({
  TEXT: 'text',
  IMAGE: 'image',
  FILE: 'file',
  SYSTEM: 'system',
});

const CONVERSATION_TYPE = Object.freeze({
  DIRECT: 'direct',
  GROUP: 'group',
});

const GROUP_ROLE = Object.freeze({
  OWNER: 'owner',
  ADMIN: 'admin',
  MEMBER: 'member',
});

/** Vai trò toàn hệ thống: manager xem log + chặn IP. User đăng ký đầu tiên = manager. */
const USER_ROLE = Object.freeze({
  MANAGER: 'manager',
  MEMBER: 'member',
});

const THEME = Object.freeze({ LIGHT: 'light', DARK: 'dark' });

const TEMP_CONVERSATION_PREFIX = 'temp-';

/** Loại action offline được queue lại (client action_queue) */
const ACTION_TYPE = Object.freeze({
  CONV_CREATE: 'conv_create',
  CONV_RENAME: 'conv_rename',
  MESSAGE_EDIT: 'message_edit',
  MESSAGE_RECALL: 'message_recall',
});

const LOG_LEVEL = Object.freeze({
  DEBUG: 'debug',
  INFO: 'info',
  WARN: 'warn',
  ERROR: 'error',
  AUDIT: 'audit',
});
const LOG_LEVEL_RANK = Object.freeze({ debug: 0, info: 1, warn: 2, error: 3, audit: 4 });

const LOG_CATEGORY = Object.freeze({
  AUTH: 'auth',
  MESSAGE: 'message',
  FILE: 'file',
  CALL: 'call',
  CONNECTION: 'connection',
  SETTINGS: 'settings',
  ERROR: 'error',
  APP: 'app',
});

/** Các key bị che khi log (so khớp không phân biệt hoa thường, theo substring) */
const LOG_REDACT_KEYS = Object.freeze(['password', 'token', 'secret', 'authorization', 'old_password', 'new_password']);
const LOG_CONTENT_PREVIEW_MAX = 100;
const LOG_BATCH_SIZE = 50;
const LOG_FLUSH_INTERVAL_MS = 10000;
const LOG_QUERY_LIMIT = 2000;

/** Mã lỗi trả về trong {error: {code, message}} */
const ERROR_CODE = Object.freeze({
  VALIDATION: 'VALIDATION',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  DUPLICATE: 'DUPLICATE',
  BLOCKED: 'BLOCKED',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  SERVER_OFFLINE: 'SERVER_OFFLINE',
  TOO_LARGE: 'TOO_LARGE',
  TIMEOUT: 'TIMEOUT',
  CANCELLED: 'CANCELLED',
  CONV_NOT_SYNCED: 'CONV_NOT_SYNCED',
  INTERNAL: 'INTERNAL',
});

/** Thông điệp UI tiếng Việt dùng chung */
const MESSAGES_VI = Object.freeze({
  INVALID_CREDENTIALS: 'Sai tên đăng nhập hoặc mật khẩu',
  PASSWORD_HINT: 'Mật khẩu chỉ dùng chữ không dấu, số và ký tự đặc biệt.',
  RECALLED: 'Tin nhắn đã được thu hồi',
  EDITED_LABEL: '(đã sửa)',
  OFFLINE_BANNER: '⚠️ Server offline — Đang chat P2P. Tin sẽ tự đồng bộ khi server online.',
  SESSION_EXPIRED: 'Phiên đăng nhập đã hết hạn. Vui lòng chờ server online để đăng nhập lại.',
  BLOCKED: 'Địa chỉ IP của bạn đã bị chặn bởi quản trị viên.',
});

module.exports = {
  APP_NAME,
  APP_VERSION,
  NETWORK,
  STATUS_ICON_SIZE,
  MAX_GROUP_READER_AVATARS,
  PAGE_SIZE,
  TEXTAREA_MAX_HEIGHT,
  TYPING_THROTTLE_MS,
  TYPING_HIDE_MS,
  HIGHLIGHT_DURATION_MS,
  REPLY_PREVIEW_MAX_CHARS,
  PIN_PREVIEW_MAX_CHARS,
  LIGHTBOX_ZOOM_MIN,
  LIGHTBOX_ZOOM_MAX,
  LIGHTBOX_ZOOM_STEP,
  TOAST_DURATION_MS,
  SEARCH_RESULT_LIMIT,
  MIN_GROUP_OTHER_MEMBERS,
  MAX_FILE_SIZE,
  MAX_AVATAR_SIZE,
  AVATAR_SIZE_PX,
  THUMB_MAX_PX,
  P2P_CHUNK_SIZE,
  IMAGE_MIME_PREFIX,
  THUMBNAILABLE_MIME,
  SESSION_TTL_MS,
  USERNAME_MIN,
  USERNAME_MAX,
  EMPLOYEE_ID_MAX,
  DISPLAY_NAME_MIN,
  DISPLAY_NAME_MAX,
  PASSWORD_MIN,
  PASSWORD_MAX,
  GROUP_NAME_MAX,
  MESSAGE_MAX_LENGTH,
  BLOCK_REASON_MAX,
  USERNAME_REGEX,
  EMPLOYEE_ID_REGEX,
  PASSWORD_ASCII_REGEX,
  IPV4_REGEX,
  URL_REGEX,
  MENTION_TRIGGER,
  MESSAGE_STATUS,
  MESSAGE_STATUS_RANK,
  SYNC_STATE,
  MESSAGE_TYPE,
  CONVERSATION_TYPE,
  GROUP_ROLE,
  USER_ROLE,
  THEME,
  TEMP_CONVERSATION_PREFIX,
  ACTION_TYPE,
  LOG_LEVEL,
  LOG_LEVEL_RANK,
  LOG_CATEGORY,
  LOG_REDACT_KEYS,
  LOG_CONTENT_PREVIEW_MAX,
  LOG_BATCH_SIZE,
  LOG_FLUSH_INTERVAL_MS,
  LOG_QUERY_LIMIT,
  ERROR_CODE,
  MESSAGES_VI,
};
