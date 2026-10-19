/**
 * Helper đăng ký IPC (DRY): mọi handler được bọc try/catch → envelope
 *   { ok: true, data } | { ok: false, error: { code, message } } (message tiếng Việt).
 */
'use strict';

const { LOG_CATEGORY, ERROR_CODE } = require('../../../shared/constants');
const { toErrorPayload } = require('../utils/errors');

/** Lỗi nghiệp vụ "bình thường" → log mức warn thay vì error */
const EXPECTED_CODES = new Set([
  ERROR_CODE.VALIDATION,
  ERROR_CODE.INVALID_CREDENTIALS,
  ERROR_CODE.SERVER_OFFLINE,
  ERROR_CODE.NOT_FOUND,
  ERROR_CODE.FORBIDDEN,
  ERROR_CODE.CANCELLED,
  ERROR_CODE.DUPLICATE,
  ERROR_CODE.CONFLICT,
  ERROR_CODE.TOO_LARGE,
  ERROR_CODE.SESSION_EXPIRED,
]);

/**
 * Bọc handler thành hàm ipcMain.handle.
 * @param {string} channel
 * @param {(payload: any, event: any) => any} fn
 * @param {object} logger
 */
function wrapHandler(channel, fn, logger) {
  return async (event, payload) => {
    try {
      const data = await fn(payload == null ? {} : payload, event);
      return { ok: true, data: data === undefined ? null : data };
    } catch (err) {
      const error = toErrorPayload(err);
      const meta = { channel, code: error.code, message: err && err.message };
      if (EXPECTED_CODES.has(error.code)) logger.warn(LOG_CATEGORY.APP, 'ipc_rejected', meta);
      else logger.error(LOG_CATEGORY.ERROR, 'ipc_failed', { ...meta, stack: err && err.stack && String(err.stack).split('\n').slice(0, 4).join(' | ') });
      return { ok: false, error };
    }
  };
}

/**
 * Đăng ký 1 bảng handler. Trùng kênh → throw (lỗi lập trình).
 * @param {{ handle: Function, removeHandler: Function }} ipcMain
 * @param {Object<string, Function>} handlers
 * @param {object} logger
 * @returns {string[]} kênh đã đăng ký
 */
function registerHandlers(ipcMain, handlers, logger) {
  const channels = Object.keys(handlers);
  for (const channel of channels) {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, wrapHandler(channel, handlers[channel], logger));
  }
  return channels;
}

module.exports = { wrapHandler, registerHandlers };
