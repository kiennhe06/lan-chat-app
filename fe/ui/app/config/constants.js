/**
 * Hằng số dùng trong renderer — lấy từ `window.api.constants` (preload, nguồn sự thật: shared/constants.js).
 * RegExp đi qua contextBridge dưới dạng {source, flags} → dựng lại RegExp ở đây.
 * Fallback an toàn khi không có window.api (renderer chạy trong trình duyệt thường).
 */
import {
  FALLBACK_CONSTANTS,
  FALLBACK_GROUP_ACTIONS,
  FALLBACK_IPC_EVENTS,
} from './fallbackConstants.js';

const bridge = typeof window !== 'undefined' ? window.api : undefined;

/** Dựng lại RegExp từ {source, flags}; giữ nguyên giá trị khác. */
function reviveRegExps(obj) {
  const out = {};
  for (const [key, value] of Object.entries(obj || {})) {
    const isSerializedRegex =
      value && typeof value === 'object' && typeof value.source === 'string' && typeof value.flags === 'string';
    out[key] = isSerializedRegex ? new RegExp(value.source, value.flags) : value;
  }
  return out;
}

const C = Object.freeze(reviveRegExps({ ...FALLBACK_CONSTANTS, ...((bridge && bridge.constants) || {}) }));

export default C;

/** Tên kênh push event main → renderer */
export const IPC_EVENTS = Object.freeze((bridge && bridge.events) || FALLBACK_IPC_EVENTS);

/** Hành động nhóm (chat.groupAction) */
export const GROUP_ACTIONS = Object.freeze((bridge && bridge.groupActions) || FALLBACK_GROUP_ACTIONS);

export const {
  STATUS_ICON_SIZE,
  MAX_GROUP_READER_AVATARS,
  PAGE_SIZE,
  MESSAGE_STATUS,
  MESSAGE_STATUS_RANK,
  SYNC_STATE,
  MESSAGE_TYPE,
  CONVERSATION_TYPE,
  GROUP_ROLE,
  USER_ROLE,
  THEME,
  MESSAGES_VI,
  ERROR_CODE,
} = C;
