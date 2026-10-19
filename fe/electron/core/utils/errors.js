/**
 * Lỗi nghiệp vụ có mã (ERROR_CODE) + thông điệp tiếng Việt hiển thị cho người dùng.
 */
'use strict';

const { ERROR_CODE } = require('../../../shared/constants');

class AppError extends Error {
  /**
   * @param {string} code một giá trị trong ERROR_CODE
   * @param {string} message thông điệp tiếng Việt
   * @param {object} [details] dữ liệu phụ (không hiển thị)
   */
  constructor(code, message, details) {
    super(message);
    this.name = 'AppError';
    this.code = code || ERROR_CODE.INTERNAL;
    if (details) this.details = details;
  }
}

const GENERIC_MESSAGE = 'Đã xảy ra lỗi không mong muốn. Vui lòng thử lại.';

/** Thông điệp mặc định theo mã (dùng khi lỗi từ server/tầng dưới không có message) */
const DEFAULT_MESSAGES = Object.freeze({
  [ERROR_CODE.SERVER_OFFLINE]: 'Không kết nối được server. Chức năng này chỉ dùng được khi server online.',
  [ERROR_CODE.TIMEOUT]: 'Server không phản hồi (hết thời gian chờ).',
  [ERROR_CODE.UNAUTHORIZED]: 'Bạn chưa đăng nhập hoặc phiên không hợp lệ.',
  [ERROR_CODE.SESSION_EXPIRED]: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
  [ERROR_CODE.NOT_FOUND]: 'Không tìm thấy dữ liệu yêu cầu.',
  [ERROR_CODE.FORBIDDEN]: 'Bạn không có quyền thực hiện thao tác này.',
  [ERROR_CODE.CANCELLED]: 'Đã hủy.',
  [ERROR_CODE.TOO_LARGE]: 'File quá lớn.',
  [ERROR_CODE.VALIDATION]: 'Dữ liệu không hợp lệ.',
});

/**
 * Chuyển mọi lỗi thành `{code, message}` an toàn để gửi qua IPC.
 * @param {unknown} err
 * @returns {{code: string, message: string}}
 */
function toErrorPayload(err) {
  if (err && typeof err === 'object' && typeof err.code === 'string' && ERROR_CODE[err.code] !== undefined) {
    return { code: err.code, message: err.message || DEFAULT_MESSAGES[err.code] || GENERIC_MESSAGE };
  }
  return { code: ERROR_CODE.INTERNAL, message: GENERIC_MESSAGE };
}

/** Lỗi validation nhanh */
const validationError = (message) => new AppError(ERROR_CODE.VALIDATION, message);
/** Lỗi khi cần server mà đang offline */
const offlineError = (message) => new AppError(ERROR_CODE.SERVER_OFFLINE, message || DEFAULT_MESSAGES[ERROR_CODE.SERVER_OFFLINE]);

module.exports = { AppError, toErrorPayload, validationError, offlineError, DEFAULT_MESSAGES, GENERIC_MESSAGE };
