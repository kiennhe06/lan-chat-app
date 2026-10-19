/**
 * Kênh đẩy sự kiện main → renderer (IPC_EVENTS). Service gọi `emit(channel, payload)`;
 * index.js gắn "sink" = webContents.send khi cửa sổ sẵn sàng. Không import Electron.
 */
'use strict';

const { IPC_EVENTS } = require('../../ipc/channels');

const ALLOWED = new Set(Object.values(IPC_EVENTS));

function createEventBus() {
  let sink = null;
  const listeners = new Set();
  return {
    /**
     * @param {string} channel giá trị trong IPC_EVENTS
     * @param {any} payload
     */
    emit(channel, payload) {
      if (!ALLOWED.has(channel)) throw new Error(`Kênh event không hợp lệ: ${channel}`);
      for (const fn of listeners) {
        try {
          fn(channel, payload);
        } catch (err) {
          console.error('[eventBus] listener lỗi:', err.message);
        }
      }
      if (sink) sink(channel, payload);
    },
    /** Gắn hàm gửi xuống renderer (null để gỡ) */
    setSink(fn) {
      sink = fn;
    },
    /** Lắng nghe nội bộ (vd: test, notification) — trả hàm hủy */
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

module.exports = { createEventBus };
