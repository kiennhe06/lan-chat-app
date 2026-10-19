/**
 * Kết nối WebSocket tới server (ws://host:port/ws): request/response theo reqId (timeout),
 * push event, tự reconnect với backoff lũy thừa, phát hiện server chết qua heartbeat.
 *
 * Chỉ lo tầng vận chuyển — xác thực (auth:reconnect...) do sessionService đảm nhận qua sự kiện 'open'.
 * Không import Electron.
 *
 * Sự kiện (EventEmitter):
 *   'state'  (state: 'disconnected'|'connecting'|'connected', info)
 *   'open'   ({ host, port, isReconnect })
 *   'close'  ({ code, reason, wasConnected })
 *   'frame'  (frame)   — push frame (không có reqId khớp)
 */
'use strict';

const { EventEmitter } = require('events');
const WebSocket = require('ws');
const { NETWORK, ERROR_CODE } = require('../../../shared/constants');
const { encodeFrame, decodeFrame } = require('../../../shared/serializer');
const { AppError, DEFAULT_MESSAGES } = require('../../core/utils/errors');

const CONN_STATE = Object.freeze({ DISCONNECTED: 'disconnected', CONNECTING: 'connecting', CONNECTED: 'connected' });
const CONNECT_TIMEOUT_MS = 5000;

/**
 * Backoff lũy thừa có jitter nhẹ.
 * @param {number} attempt bắt đầu từ 0
 */
function backoffDelay(attempt, minMs, maxMs) {
  const base = Math.min(maxMs, minMs * 2 ** Math.min(attempt, 10));
  return Math.round(base * (0.8 + Math.random() * 0.4));
}

class ServerConnection extends EventEmitter {
  /**
   * @param {{ requestTimeoutMs?: number, reconnectMinMs?: number, reconnectMaxMs?: number,
   *   logger?: object, WebSocketImpl?: typeof WebSocket }} [opts]
   */
  constructor(opts) {
    super();
    const o = opts || {};
    this.requestTimeoutMs = o.requestTimeoutMs || NETWORK.REQUEST_TIMEOUT_MS;
    this.reconnectMinMs = o.reconnectMinMs || NETWORK.RECONNECT_MIN_MS;
    this.reconnectMaxMs = o.reconnectMaxMs || NETWORK.RECONNECT_MAX_MS;
    this.log = o.logger;
    this.WebSocketImpl = o.WebSocketImpl || WebSocket;
    this.ws = null;
    this.server = null; // {host, port}
    this.state = CONN_STATE.DISCONNECTED;
    this.pending = new Map(); // reqId → {resolve, reject, timer, type}
    this.reqSeq = 0;
    this.autoReconnect = false;
    this.reconnectAttempt = 0;
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    this.hasConnectedOnce = false;
  }

  /** URL ws tới server */
  static buildUrl(host, port) {
    return `ws://${host}:${port}${NETWORK.WS_PATH}`;
  }

  isConnected() {
    return this.state === CONN_STATE.CONNECTED && this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  _setState(state, info) {
    if (this.state === state) return;
    this.state = state;
    this.emit('state', state, info || {});
  }

  /**
   * Mở kết nối tới server (đóng kết nối cũ nếu khác server).
   * @param {{host: string, port: number}} server
   * @returns {Promise<void>}
   */
  connect(server) {
    this._clearReconnect();
    if (this.ws) this._teardown(1000, 'switch-server');
    this.server = { host: server.host, port: Number(server.port) || NETWORK.SERVER_PORT };
    return this._open(false);
  }

  _open(isReconnect) {
    return new Promise((resolve, reject) => {
      const { host, port } = this.server;
      this._setState(CONN_STATE.CONNECTING, { host, port });
      let settled = false;
      let ws;
      try {
        ws = new this.WebSocketImpl(ServerConnection.buildUrl(host, port), {
          handshakeTimeout: CONNECT_TIMEOUT_MS,
          perMessageDeflate: false,
          maxPayload: 64 * 1024 * 1024,
        });
      } catch (err) {
        this._setState(CONN_STATE.DISCONNECTED, { error: err.message });
        reject(new AppError(ERROR_CODE.SERVER_OFFLINE, `Địa chỉ server không hợp lệ: ${host}:${port}`));
        return;
      }
      this.ws = ws;

      ws.on('open', () => {
        settled = true;
        this.reconnectAttempt = 0;
        this.hasConnectedOnce = true;
        this._setState(CONN_STATE.CONNECTED, { host, port });
        this._startHeartbeatWatch();
        resolve();
        this.emit('open', { host, port, isReconnect });
      });
      ws.on('ping', () => this._startHeartbeatWatch());
      ws.on('message', (raw, isBinary) => {
        if (isBinary) return;
        this._onFrame(raw);
      });
      ws.on('error', (err) => {
        if (this.log) this.log.debug('connection', 'ws_error', { message: err.message });
        if (!settled) {
          settled = true;
          reject(new AppError(ERROR_CODE.SERVER_OFFLINE, `Không kết nối được server ${host}:${port}`));
        }
      });
      ws.on('close', (code, reasonBuf) => {
        if (this.ws !== ws) return; // socket cũ đã bị thay
        const wasConnected = this.state === CONN_STATE.CONNECTED;
        this.ws = null;
        this._stopHeartbeatWatch();
        this._rejectAllPending(new AppError(ERROR_CODE.SERVER_OFFLINE, 'Mất kết nối tới server'));
        this._setState(CONN_STATE.DISCONNECTED, { code });
        if (!settled) {
          settled = true;
          reject(new AppError(ERROR_CODE.SERVER_OFFLINE, `Không kết nối được server ${host}:${port}`));
        }
        this.emit('close', { code, reason: reasonBuf ? reasonBuf.toString() : '', wasConnected });
        this._scheduleReconnect();
      });
    });
  }

  _onFrame(raw) {
    const frame = decodeFrame(raw);
    if (!frame) return;
    if (frame.reqId && this.pending.has(frame.reqId)) {
      const p = this.pending.get(frame.reqId);
      this.pending.delete(frame.reqId);
      clearTimeout(p.timer);
      if (frame.error) {
        p.reject(new AppError(frame.error.code || ERROR_CODE.INTERNAL, frame.error.message || DEFAULT_MESSAGES[frame.error.code], { type: frame.type }));
      } else {
        p.resolve(frame.data === undefined ? {} : frame.data);
      }
      return;
    }
    this.emit('frame', frame);
  }

  /**
   * Gửi request và chờ frame trả lời cùng reqId.
   * @param {string} type
   * @param {object} [data]
   * @param {{ timeoutMs?: number }} [opts]
   * @returns {Promise<any>} frame.data
   */
  request(type, data, opts) {
    if (!this.isConnected()) {
      return Promise.reject(new AppError(ERROR_CODE.SERVER_OFFLINE, DEFAULT_MESSAGES[ERROR_CODE.SERVER_OFFLINE]));
    }
    this.reqSeq += 1;
    const reqId = `r-${Date.now().toString(36)}-${this.reqSeq}`;
    const timeoutMs = (opts && opts.timeoutMs) || this.requestTimeoutMs;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(reqId);
        reject(new AppError(ERROR_CODE.TIMEOUT, DEFAULT_MESSAGES[ERROR_CODE.TIMEOUT], { type }));
      }, timeoutMs);
      this.pending.set(reqId, { resolve, reject, timer, type });
      try {
        this.ws.send(encodeFrame(type, data || {}, { reqId }));
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(reqId);
        reject(new AppError(ERROR_CODE.SERVER_OFFLINE, `Gửi tới server thất bại: ${err.message}`));
      }
    });
  }

  /**
   * Gửi 1 chiều (không chờ trả lời).
   * @returns {boolean} đã gửi hay không
   */
  send(type, data) {
    if (!this.isConnected()) return false;
    try {
      this.ws.send(encodeFrame(type, data || {}));
      return true;
    } catch (err) {
      if (this.log) this.log.warn('connection', 'send_failed', { type, message: err.message });
      return false;
    }
  }

  /** Bật/tắt tự reconnect khi mất kết nối */
  setAutoReconnect(enabled) {
    this.autoReconnect = !!enabled;
    if (!enabled) this._clearReconnect();
  }

  /** Thử kết nối lại ngay (vd: vừa nghe server:announce) — reset backoff */
  reconnectNow() {
    if (!this.server || this.isConnected() || this.state === CONN_STATE.CONNECTING) return;
    this._clearReconnect();
    this.reconnectAttempt = 0;
    this._open(true).catch(() => {
      /* lỗi đã xử lý qua 'close' + lịch reconnect */
    });
  }

  _scheduleReconnect() {
    if (!this.autoReconnect || !this.server || this.reconnectTimer) return;
    const wait = backoffDelay(this.reconnectAttempt, this.reconnectMinMs, this.reconnectMaxMs);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.isConnected() || this.state === CONN_STATE.CONNECTING) return;
      this._open(true).catch(() => {
        /* 'close' sẽ lên lịch lần tiếp theo */
      });
    }, wait);
    if (this.reconnectTimer.unref) this.reconnectTimer.unref();
  }

  _clearReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  /**
   * Server gửi ping mỗi 15s; quá 2.5 chu kỳ không thấy ping → coi như chết, terminate để reconnect.
   */
  _startHeartbeatWatch() {
    this._stopHeartbeatWatch();
    this.heartbeatTimer = setTimeout(() => {
      if (this.ws) {
        if (this.log) this.log.warn('connection', 'heartbeat_timeout', this.server);
        this.ws.terminate();
      }
    }, NETWORK.HEARTBEAT_INTERVAL_MS * 2.5);
    if (this.heartbeatTimer.unref) this.heartbeatTimer.unref();
  }

  _stopHeartbeatWatch() {
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  _rejectAllPending(err) {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
  }

  _teardown(code, reason) {
    const ws = this.ws;
    this.ws = null;
    this._stopHeartbeatWatch();
    this._rejectAllPending(new AppError(ERROR_CODE.SERVER_OFFLINE, 'Đã đóng kết nối tới server'));
    if (ws) {
      ws.removeAllListeners('close');
      ws.on('error', () => {});
      try {
        ws.close(code, reason);
      } catch (_err) {
        ws.terminate();
      }
    }
    this._setState(CONN_STATE.DISCONNECTED, {});
  }

  /** Đóng hẳn (logout / thoát app) — tắt auto reconnect */
  close() {
    this.setAutoReconnect(false);
    this._teardown(1000, 'client-close');
  }
}

module.exports = { ServerConnection, CONN_STATE, backoffDelay };
