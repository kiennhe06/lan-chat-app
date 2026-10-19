/**
 * Ngữ cảnh của request đang xử lý (IP client), truyền ngầm qua các hàm async bằng AsyncLocalStorage.
 * Nhờ vậy logger tự gắn IP cho mọi log phát sinh trong lúc xử lý 1 frame WS / 1 request HTTP
 * mà không phải truyền tham số `ip` qua từng service.
 */
'use strict';

const { AsyncLocalStorage } = require('async_hooks');

const storage = new AsyncLocalStorage();

/**
 * Chạy `fn` trong ngữ cảnh request.
 * @template T
 * @param {{ ip?: string }} context
 * @param {() => T} fn
 * @returns {T}
 */
function runWithRequestContext(context, fn) {
  return storage.run(context, fn);
}

/** IP của request hiện tại (null nếu đang ở ngoài request, vd: tác vụ định kỳ). */
function currentRequestIp() {
  const context = storage.getStore();
  return (context && context.ip) || null;
}

module.exports = { runWithRequestContext, currentRequestIp };
