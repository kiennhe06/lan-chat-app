/**
 * Lỗi nghiệp vụ có mã (ERROR_CODE) + thông điệp tiếng Việt.
 * Tầng transport (ws.js / http.js) chuyển AppError thành { code, message } trên dây.
 */
'use strict';

const C = require('../shared/constants');

class AppError extends Error {
  /**
   * @param {string} code giá trị trong ERROR_CODE
   * @param {string} message thông điệp tiếng Việt cho người dùng
   * @param {object} [details] dữ liệu phụ (không gửi lên dây)
   */
  constructor(code, message, details) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    if (details) this.details = details;
  }
}

const E = C.ERROR_CODE;

/** Các factory ngắn gọn để throw ở service. */
const errors = {
  validation: (msg) => new AppError(E.VALIDATION, msg),
  unauthorized: (msg) => new AppError(E.UNAUTHORIZED, msg || 'Chưa đăng nhập'),
  forbidden: (msg) => new AppError(E.FORBIDDEN, msg || 'Bạn không có quyền thực hiện thao tác này'),
  notFound: (msg) => new AppError(E.NOT_FOUND, msg || 'Không tìm thấy dữ liệu'),
  duplicate: (msg) => new AppError(E.DUPLICATE, msg),
  conflict: (msg) => new AppError(E.CONFLICT, msg),
  invalidCredentials: () => new AppError(E.INVALID_CREDENTIALS, C.MESSAGES_VI.INVALID_CREDENTIALS),
  sessionExpired: () => new AppError(E.SESSION_EXPIRED, C.MESSAGES_VI.SESSION_EXPIRED),
  blocked: () => new AppError(E.BLOCKED, C.MESSAGES_VI.BLOCKED),
  tooLarge: (msg) => new AppError(E.TOO_LARGE, msg || 'File vượt quá dung lượng cho phép'),
  convNotSynced: () => new AppError(E.CONV_NOT_SYNCED, 'Cuộc trò chuyện chưa được đồng bộ lên server'),
};

/**
 * Chuyển lỗi bất kỳ thành object lỗi trên dây. Lỗi không phải AppError → INTERNAL (ẩn chi tiết).
 * @param {unknown} err
 * @returns {{ code: string, message: string }}
 */
function toWireError(err) {
  if (err instanceof AppError) return { code: err.code, message: err.message };
  return { code: E.INTERNAL, message: 'Lỗi máy chủ, vui lòng thử lại' };
}

const isAppError = (err) => err instanceof AppError;

module.exports = { AppError, errors, toWireError, isAppError };
