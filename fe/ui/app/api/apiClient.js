/**
 * Cổng truy cập DUY NHẤT tới `window.api` (preload) cho tầng hooks.
 * Component KHÔNG import file này — chỉ hooks/*.js và db/localDb.js.
 */
import { ERROR_CODE } from '../config/constants.js';

/**
 * Trả về `window.api`. Ném lỗi dạng {code, message} nếu preload chưa sẵn sàng.
 * @returns {any}
 */
export function getApi() {
  if (typeof window === 'undefined' || !window.api) {
    throw { code: ERROR_CODE.INTERNAL, message: 'Không tìm thấy cầu nối ứng dụng (preload)' };
  }
  return window.api;
}

/**
 * Đăng ký push event từ main process.
 * @param {string} channel giá trị trong IPC_EVENTS
 * @param {(payload:any)=>void} callback
 * @returns {() => void} hủy đăng ký
 */
export function onApiEvent(channel, callback) {
  try {
    return getApi().on(channel, callback);
  } catch (err) {
    console.error('[apiClient] Không đăng ký được event', channel, err);
    return () => {};
  }
}

/**
 * Chuẩn hóa lỗi (preload reject plain object {code, message}) thành thông điệp tiếng Việt cho UI.
 * @param {unknown} err
 * @param {string} [fallback]
 * @returns {string}
 */
export function errorMessage(err, fallback = 'Đã xảy ra lỗi') {
  if (!err) return fallback;
  if (typeof err === 'string') return err;
  if (typeof err === 'object' && typeof err.message === 'string' && err.message) return err.message;
  return fallback;
}

/** true nếu lỗi là do người dùng hủy thao tác */
export function isCancelled(err) {
  return Boolean(err && typeof err === 'object' && err.code === ERROR_CODE.CANCELLED);
}
