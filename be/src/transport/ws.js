/**
 * WebSocket server (path /ws, dùng chung HTTP server cổng 5001).
 *
 * - Frame: { type, data?, reqId?, error? } (shared/serializer). Request có reqId → trả ĐÚNG 1 frame cùng reqId.
 * - Frame đầu tiên phải là auth:login / auth:register / auth:reconnect (timeout 10s).
 * - Mỗi kết nối xử lý frame tuần tự (hàng đợi promise) → giữ thứ tự gửi/sửa/thu hồi.
 * - Heartbeat ping/pong 15s; socket không pong bị terminate.
 * - IP bị chặn → auth:kicked + đóng.
 * Tầng này chỉ điều hướng type → service; không chứa nghiệp vụ.
 */
'use strict';

const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { runWithRequestContext } = require('../core/requestContext');
const C = require('../shared/constants');
const W = require('../shared/wsEvents');
const { decodeFrame } = require('../shared/serializer');
const { normalizeIp } = require('../core/utils/network');
const { toWireError, isAppError, errors } = require('../core/errors');
const { CLOSE_CODE } = require('../core/hub');

const CAT = C.LOG_CATEGORY.CONNECTION;
const REQ_ID_MAX = 100;

/**
 * Bảng định tuyến: type → { ok, err?, public?, manager?, run(conn, data), after?(conn) }.
 * run trả về data cho frame `ok`; trả undefined → không gửi frame thành công (event một chiều).
 * @param {object} s services
 * @param {object} ctx { hub, logger }
 */
function buildRoutes(s, ctx) {
  const ack = { ok: true };

  /** Sau khi xác thực OK: gắn user vào hub, presence, gửi presence:list. */
  const authRoute = (okType, errType, fn) => ({
    ok: okType,
    err: errType,
    public: true,
    run: async (conn, data) => {
      if (conn.userId) throw errors.validation('Kết nối đã đăng nhập');
      const result = await fn(data, conn.ip);
      const { cameOnline } = ctx.hub.bindUser(conn, result.user.id, result.session.jti);
      conn.role = result.user.role;
      clearTimeout(conn.authTimer);
      ctx.logger.info(CAT, 'ws_authenticated', { conn_id: conn.id, via: okType }, { userId: result.user.id, ip: conn.ip });
      conn.afterReply = () => {
        if (cameOnline) s.presence.userCameOnline(result.user.id);
        ctx.hub.send(conn, W.PRESENCE.LIST, s.presence.snapshot());
      };
      return result.payload;
    },
  });

  const callRoute = (type) => ({ ok: type, run: (conn, data) => s.presence.relayCall(conn.userId, type, data) });

  return {
    [W.AUTH.REGISTER]: authRoute(W.AUTH.REGISTER_OK, W.AUTH.REGISTER_ERR, (d, ip) => s.auth.register(d, ip)),
    [W.AUTH.LOGIN]: authRoute(W.AUTH.LOGIN_OK, W.AUTH.LOGIN_ERR, (d, ip) => s.auth.login(d, ip)),
    [W.AUTH.RECONNECT]: authRoute(W.AUTH.RECONNECT_OK, W.AUTH.RECONNECT_ERR, async (d, ip) => s.auth.reconnect(d, ip)),
    [W.AUTH.LOGOUT]: {
      ok: W.AUTH.LOGOUT_OK,
      run: (conn) => {
        const result = s.auth.logout(conn.userId, conn.jti, conn.ip);
        conn.afterReply = () => conn.ws.close(CLOSE_CODE.NORMAL, 'logout');
        return result;
      },
    },

    [W.USER.LIST]: { ok: W.USER.LIST_RESULT, run: () => ({ users: s.auth.listUsers() }) },
    [W.USER.UPDATE_PROFILE]: { ok: W.USER.UPDATE_PROFILE_RESULT, run: (conn, d) => s.auth.updateProfile(conn.userId, d, conn.ip) },
    [W.USER.UPDATE_SETTINGS]: { ok: W.USER.UPDATE_SETTINGS_RESULT, run: (conn, d) => s.auth.updateSettings(conn.userId, d) },
    [W.USER.CHANGE_PASSWORD]: {
      ok: W.USER.CHANGE_PASSWORD_RESULT,
      run: async (conn, d) => {
        const { jti, ...result } = await s.auth.changePassword(conn.userId, d, conn.ip);
        conn.jti = jti; // socket hiện tại dùng session mới
        conn.afterReply = () => ctx.hub.kickUserSessions(conn.userId, jti, 'Mật khẩu đã được thay đổi. Vui lòng đăng nhập lại.');
        return result;
      },
    },

    [W.MESSAGE.SEND]: { ok: W.MESSAGE.SENT, run: (conn, d) => ({ message: s.message.send(conn.userId, d, { ip: conn.ip }).message }) },
    [W.MESSAGE.EDIT]: { ok: W.MESSAGE.RESULT, run: (conn, d) => (s.message.edit(conn.userId, d, { ip: conn.ip }), ack) },
    [W.MESSAGE.RECALL]: { ok: W.MESSAGE.RESULT, run: (conn, d) => (s.message.recall(conn.userId, d, { ip: conn.ip }), ack) },
    [W.MESSAGE.PIN]: { ok: W.MESSAGE.RESULT, run: (conn, d) => (s.message.pin(conn.userId, d), ack) },
    [W.MESSAGE.UNPIN]: { ok: W.MESSAGE.RESULT, run: (conn, d) => (s.message.unpin(conn.userId, d), ack) },
    [W.MESSAGE.DELIVERED]: { ok: W.MESSAGE.RESULT, run: (conn, d) => s.message.markCursor(conn.userId, d, C.MESSAGE_STATUS.DELIVERED) },
    [W.MESSAGE.READ]: { ok: W.MESSAGE.RESULT, run: (conn, d) => s.message.markCursor(conn.userId, d, C.MESSAGE_STATUS.READ) },
    [W.MESSAGE.HISTORY]: { ok: W.MESSAGE.HISTORY_RESULT, run: (conn, d) => s.message.history(conn.userId, d) },

    [W.CONV.LIST]: { ok: W.CONV.LIST_RESULT, run: (conn) => ({ conversations: s.conversation.listForUser(conn.userId) }) },
    [W.CONV.CREATE]: { ok: W.CONV.CREATED, run: (conn, d) => ({ conversation: s.conversation.create(conn.userId, d).conversation }) },
    [W.CONV.RENAME]: {
      ok: W.CONV.RESULT,
      run: (conn, d) => {
        const r = s.conversation.rename(conn.userId, d);
        return { ok: true, conflict: r.conflict, conversation: r.conversation };
      },
    },
    [W.CONV.ADD_MEMBER]: { ok: W.CONV.ADD_MEMBER_RESULT, run: (conn, d) => s.conversation.addMembers(conn.userId, d) },
    [W.CONV.APPROVE_MEMBER]: { ok: W.CONV.RESULT, run: (conn, d) => s.conversation.approveMember(conn.userId, d) },
    [W.CONV.REJECT_MEMBER]: { ok: W.CONV.RESULT, run: (conn, d) => s.conversation.rejectMember(conn.userId, d) },
    [W.CONV.REMOVE_MEMBER]: { ok: W.CONV.RESULT, run: (conn, d) => s.conversation.removeMember(conn.userId, d) },
    [W.CONV.SET_ADMIN]: { ok: W.CONV.RESULT, run: (conn, d) => s.conversation.setAdmin(conn.userId, d) },
    [W.CONV.DELETE]: { ok: W.CONV.RESULT, run: (conn, d) => s.conversation.remove(conn.userId, d) },
    [W.CONV.REQUEST_PENDING]: { ok: W.CONV.PENDING_LIST, run: (conn, d) => s.conversation.listPending(conn.userId, d) },

    [W.SYNC.REQUEST]: { ok: W.SYNC.RESPONSE, run: (conn, d) => s.sync.request(conn.userId, d) },
    [W.SYNC.MESSAGE_BATCH]: { ok: W.SYNC.MESSAGE_BATCH_ACK, run: (conn, d) => s.sync.messageBatch(conn.userId, d, conn.ip) },
    [W.SYNC.ACTION_BATCH]: { ok: W.SYNC.ACTION_BATCH_ACK, run: (conn, d) => s.sync.actionBatch(conn.userId, d, conn.ip) },
    [W.SYNC.FILE_BATCH]: { ok: W.SYNC.FILE_BATCH_ACK, run: (conn, d) => s.sync.fileBatch(conn.userId, d) },
    [W.SYNC.ACK]: { ok: W.SYNC.ACK, run: (conn, d) => s.sync.ack(conn.userId, d, conn.ip) },

    [W.TYPING.TYPING]: { ok: W.TYPING.TYPING, run: (conn, d) => (s.presence.relayTyping(conn.userId, d), undefined) },
    [W.CALL.OFFER]: callRoute(W.CALL.OFFER),
    [W.CALL.ANSWER]: callRoute(W.CALL.ANSWER),
    [W.CALL.ICE_CANDIDATE]: callRoute(W.CALL.ICE_CANDIDATE),
    [W.CALL.END]: callRoute(W.CALL.END),

    [W.LOG.BATCH]: { ok: W.LOG.ACK, run: (conn, d) => s.logAggregator.ingest(currentUser(s, conn), conn.ip, d && d.logs) },
    [W.LOG.EVENT]: { ok: W.LOG.ACK, run: (conn, d) => s.logAggregator.ingest(currentUser(s, conn), conn.ip, [d && d.log]) },

    [W.ADMIN.LIST_BLOCKED]: { ok: W.ADMIN.BLOCKED_LIST, run: (conn) => s.admin.list(currentUser(s, conn)) },
    [W.ADMIN.BLOCK_IP]: { ok: W.ADMIN.BLOCK_IP_RESULT, run: (conn, d) => s.admin.block(currentUser(s, conn), d, conn.ip) },
    [W.ADMIN.UNBLOCK_IP]: { ok: W.ADMIN.UNBLOCK_IP_RESULT, run: (conn, d) => s.admin.unblock(currentUser(s, conn), d, conn.ip) },

    [W.SYSTEM.PING]: { ok: W.SYSTEM.PONG, public: true, run: () => ({ server_time: new Date().toISOString() }) },
  };
}

/** Row user hiện tại (đọc lại từ DB để quyền/tên luôn mới). */
function currentUser(s, conn) {
  const user = s.auth.getUserRow(conn.userId);
  if (!user) throw errors.unauthorized();
  return user;
}

/**
 * Tạo WS server gắn vào HTTP server.
 * @param {{ httpServer: import('http').Server, hub: object, services: object, logger: object, config: object }} deps
 */
function createWsServer(deps) {
  const { httpServer, hub, services, logger, config } = deps;
  const routes = buildRoutes(services, { hub, logger });
  const wss = new WebSocketServer({ server: httpServer, path: C.NETWORK.WS_PATH, maxPayload: config.ws.maxPayloadBytes });

  /** Gửi lỗi theo đúng loại frame của route. */
  function replyError(conn, route, reqId, err) {
    const type = (route && (route.err || route.ok)) || W.SYSTEM.ERROR;
    hub.send(conn, type, undefined, { reqId, error: toWireError(err) });
  }

  async function handleFrame(conn, raw, isBinary) {
    const frame = isBinary ? null : decodeFrame(raw);
    if (!frame) {
      hub.send(conn, W.SYSTEM.ERROR, undefined, { error: toWireError(errors.validation('Frame không hợp lệ')) });
      return;
    }
    const reqId = typeof frame.reqId === 'string' && frame.reqId.length <= REQ_ID_MAX ? frame.reqId : undefined;
    const route = routes[frame.type];
    if (!route) {
      hub.send(conn, W.SYSTEM.ERROR, { type: frame.type }, { reqId, error: toWireError(errors.validation('Sự kiện không được hỗ trợ')) });
      return;
    }
    if (!route.public && !conn.userId) {
      replyError(conn, route, reqId, errors.unauthorized());
      return;
    }
    conn.afterReply = null;
    try {
      const data = await runWithRequestContext({ ip: conn.ip }, () => route.run(conn, frame.data || {}));
      if (data !== undefined && (reqId || route.public)) hub.send(conn, route.ok, data, { reqId });
      if (conn.afterReply) conn.afterReply();
    } catch (err) {
      if (!isAppError(err)) {
        logger.error(C.LOG_CATEGORY.ERROR, 'ws_handler_failed', { type: frame.type, error: err }, { userId: conn.userId, ip: conn.ip });
      }
      replyError(conn, route, reqId, err);
    } finally {
      conn.afterReply = null;
    }
  }

  function onConnection(ws, req) {
    const ip = normalizeIp(req.socket.remoteAddress);
    const conn = { id: crypto.randomUUID(), ws, ip, userId: null, jti: null, role: null, isAlive: true, queue: Promise.resolve(), authTimer: null };
    if (services.admin.isBlocked(ip)) {
      logger.logAudit(C.LOG_LEVEL.AUDIT, CAT, 'blocked_ip_rejected', null, {}, ip);
      hub.send(conn, W.AUTH.KICKED, { reason: C.MESSAGES_VI.BLOCKED });
      ws.close(CLOSE_CODE.KICKED, 'blocked');
      return;
    }
    hub.add(conn);
    logger.info(CAT, 'ws_open', { conn_id: conn.id }, { ip });
    conn.authTimer = setTimeout(() => {
      if (conn.userId) return;
      logger.info(CAT, 'ws_auth_timeout', { conn_id: conn.id }, { ip });
      ws.close(CLOSE_CODE.AUTH_TIMEOUT, 'auth timeout');
    }, config.auth.authTimeoutMs);

    ws.on('pong', () => {
      conn.isAlive = true;
    });
    ws.on('message', (raw, isBinary) => {
      // Xử lý tuần tự từng frame của 1 kết nối
      conn.queue = conn.queue
        .then(() => handleFrame(conn, raw, isBinary))
        .catch((err) => logger.error(C.LOG_CATEGORY.ERROR, 'ws_queue_failed', { error: err }, { userId: conn.userId, ip }));
    });
    ws.on('error', (err) => logger.warn(CAT, 'ws_error', { conn_id: conn.id, error: err.message }, { userId: conn.userId, ip }));
    ws.on('close', (code) => {
      clearTimeout(conn.authTimer);
      const { userId, wentOffline } = hub.remove(conn);
      logger.info(CAT, 'ws_close', { conn_id: conn.id, code }, { userId, ip });
      if (wentOffline) services.presence.userWentOffline(userId);
    });
  }

  wss.on('connection', (ws, req) => {
    try {
      onConnection(ws, req);
    } catch (err) {
      logger.error(C.LOG_CATEGORY.ERROR, 'ws_connection_failed', { error: err });
      ws.terminate();
    }
  });
  wss.on('error', (err) => logger.error(C.LOG_CATEGORY.ERROR, 'wss_error', { error: err }));

  // Heartbeat: socket không trả pong trong 1 chu kỳ → terminate
  const heartbeat = setInterval(() => {
    for (const conn of hub.connections()) {
      if (!conn.isAlive) {
        logger.info(CAT, 'ws_heartbeat_timeout', { conn_id: conn.id }, { userId: conn.userId, ip: conn.ip });
        conn.ws.terminate();
        continue;
      }
      conn.isAlive = false;
      try {
        conn.ws.ping();
      } catch (err) {
        logger.warn(CAT, 'ws_ping_failed', { conn_id: conn.id, error: err.message });
      }
    }
  }, config.ws.heartbeatIntervalMs);
  heartbeat.unref();

  /** Đóng WS server (tắt server). */
  function close() {
    clearInterval(heartbeat);
    hub.closeAll('server shutdown');
    return new Promise((resolve) => {
      wss.close(() => resolve());
      // Đảm bảo các socket không phản hồi close handshake cũng bị đóng
      for (const client of wss.clients) client.terminate();
    });
  }

  return { wss, close };
}

module.exports = { createWsServer };
