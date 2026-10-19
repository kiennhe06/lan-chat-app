/**
 * Sổ đăng ký kết nối WebSocket (transport) + các hàm gửi/broadcast.
 * Services nhận object này như một "notifier" (dependency injection) — không biết gì về thư viện ws.
 *
 * Một user có thể có nhiều socket (nhiều máy / nhiều cửa sổ): online khi có socket đầu tiên,
 * offline khi mất socket cuối cùng.
 */
'use strict';

const WebSocket = require('ws');
const C = require('../shared/constants');
const W = require('../shared/wsEvents');
const { encodeFrame } = require('../shared/serializer');

const CLOSE_CODE = Object.freeze({
  NORMAL: 1000,
  GOING_AWAY: 1001,
  POLICY: 1008,
  KICKED: 4003,
  AUTH_TIMEOUT: 4001,
});

/**
 * @param {{ logger: object }} deps
 */
function createHub(deps) {
  const { logger } = deps;
  const conns = new Set();
  /** @type {Map<number, Set<object>>} */
  const byUser = new Map();

  /** Gửi chuỗi đã encode tới 1 socket; lỗi gửi → log (socket hỏng sẽ bị heartbeat dọn). */
  function sendRaw(conn, payload) {
    if (!conn || conn.ws.readyState !== WebSocket.OPEN) return false;
    try {
      conn.ws.send(payload);
      return true;
    } catch (err) {
      logger.warn(C.LOG_CATEGORY.CONNECTION, 'ws_send_failed', { conn_id: conn.id, error: err.message });
      return false;
    }
  }

  /**
   * Gửi 1 frame tới 1 kết nối.
   * @param {object} conn
   * @param {string} type
   * @param {object} [data]
   * @param {{ reqId?: string, error?: object }} [extra]
   */
  const send = (conn, type, data, extra) => sendRaw(conn, encodeFrame(type, data, extra));

  /** Gửi push event tới mọi socket của danh sách user. */
  function toUsers(userIds, type, data) {
    const payload = encodeFrame(type, data);
    for (const id of new Set(userIds)) {
      for (const conn of byUser.get(id) || []) sendRaw(conn, payload);
    }
  }

  /** Gửi push event tới mọi socket đã xác thực. */
  function toAll(type, data) {
    const payload = encodeFrame(type, data);
    for (const set of byUser.values()) for (const conn of set) sendRaw(conn, payload);
  }

  const add = (conn) => conns.add(conn);

  /**
   * Gắn user vào kết nối sau khi auth OK.
   * @returns {{ cameOnline: boolean }}
   */
  function bindUser(conn, userId, jti) {
    conn.userId = userId;
    conn.jti = jti;
    let set = byUser.get(userId);
    const cameOnline = !set || set.size === 0;
    if (!set) {
      set = new Set();
      byUser.set(userId, set);
    }
    set.add(conn);
    return { cameOnline };
  }

  /**
   * Gỡ kết nối khỏi sổ.
   * @returns {{ userId: number|null, wentOffline: boolean }}
   */
  function remove(conn) {
    conns.delete(conn);
    const userId = conn.userId || null;
    if (!userId) return { userId: null, wentOffline: false };
    const set = byUser.get(userId);
    if (!set || !set.delete(conn)) return { userId, wentOffline: false };
    if (set.size === 0) byUser.delete(userId);
    return { userId, wentOffline: set.size === 0 };
  }

  const isOnline = (userId) => byUser.has(userId) && byUser.get(userId).size > 0;
  const onlineUserIds = () => Array.from(byUser.keys());

  /** Gửi auth:kicked rồi đóng socket. */
  function kick(conn, reason) {
    send(conn, W.AUTH.KICKED, { reason });
    try {
      conn.ws.close(CLOSE_CODE.KICKED, 'kicked');
    } catch (err) {
      logger.warn(C.LOG_CATEGORY.CONNECTION, 'ws_close_failed', { conn_id: conn.id, error: err.message });
      conn.ws.terminate();
    }
  }

  /**
   * Kick mọi kết nối (kể cả chưa auth) từ 1 IP.
   * @returns {number} số socket bị kick
   */
  function kickIp(ip, reason) {
    let count = 0;
    for (const conn of conns) {
      if (conn.ip !== ip) continue;
      kick(conn, reason);
      count += 1;
    }
    return count;
  }

  /**
   * Kick các socket của user đang dùng session khác keepJti (sau khi đổi mật khẩu).
   * @returns {number}
   */
  function kickUserSessions(userId, keepJti, reason) {
    let count = 0;
    for (const conn of byUser.get(userId) || []) {
      if (conn.jti === keepJti) continue;
      kick(conn, reason);
      count += 1;
    }
    return count;
  }

  /** Đóng mọi socket (tắt server). */
  function closeAll(reason) {
    for (const conn of conns) {
      try {
        conn.ws.close(CLOSE_CODE.GOING_AWAY, reason || 'server shutdown');
      } catch (err) {
        logger.warn(C.LOG_CATEGORY.CONNECTION, 'ws_close_failed', { conn_id: conn.id, error: err.message });
      }
    }
  }

  return {
    add,
    remove,
    bindUser,
    send,
    toUsers,
    toAll,
    isOnline,
    onlineUserIds,
    kickIp,
    kickUserSessions,
    closeAll,
    connections: () => Array.from(conns),
  };
}

module.exports = { createHub, CLOSE_CODE };
