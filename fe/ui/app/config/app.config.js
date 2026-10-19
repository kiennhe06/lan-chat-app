/**
 * Cấu hình cấp UI (không phải hằng số giao thức).
 */
import C from './constants.js';

/** Danh sách emoji tích hợp sẵn (không dùng thư viện emoji tải dữ liệu online). */
export const EMOJI_LIST = Object.freeze([
  '😀', '😁', '😂', '🤣', '😊', '😍', '😘', '😎',
  '🤔', '😅', '😢', '😭', '😡', '😱', '😴', '🤗',
  '🙏', '👍', '👎', '👏', '🙌', '💪', '👌', '✌️',
  '❤️', '💔', '🔥', '🎉', '✅', '❌', '⭐', '💯',
  '☕', '🍜', '🎂', '📌', '📎', '📞', '⏰', '🚀',
]);

/** Thời gian hiển thị toast theo loại (ms) */
export const TOAST_DURATION = Object.freeze({
  info: C.TOAST_DURATION_MS,
  success: C.TOAST_DURATION_MS,
  warn: C.TOAST_DURATION_MS * 1.5,
  error: C.TOAST_DURATION_MS * 2,
});

/** Khoảng cách (px) tới đáy được coi là "đang ở cuối danh sách" */
export const SCROLL_BOTTOM_THRESHOLD = 80;
/** Khoảng cách (px) tới đỉnh để kích hoạt tải thêm tin cũ */
export const SCROLL_TOP_THRESHOLD = 60;
/** Trì hoãn đánh dấu đã đọc (ms) để gộp nhiều tin đến liên tiếp */
export const MARK_READ_DEBOUNCE_MS = 400;
/** Key lưu cài đặt local (client.db settings) */
export const SETTING_KEYS = Object.freeze({
  LAST_SERVER: 'ui.last_server',
  THEME: 'theme',
});
/** Số mục tối đa hiển thị trong dropdown mention */
export const MENTION_MAX_ITEMS = 8;
