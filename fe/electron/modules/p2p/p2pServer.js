/**
 * Tầng vận chuyển P2P (PROTOCOL §8): WebSocket server :5002 + pool kết nối ra tới peer.
 *
 * - Chỉ nhận kết nối từ IP cùng subnet với 1 interface local hoặc loopback.
 * - Handshake 2 chiều: bên kết nối gửi p2p:hello {session_token, instance_id, vector_clock};
 *   bên nhận verify token bằng server_public_key đã cache (Ed25519, không cần server) → p2p:hello-ack
 *   kèm token của mình; bên kết nối verify ngược lại. Sai → p2p:error UNAUTHORIZED + đóng.
 * - Frame JSON như server ({type, data, reqId}); request/response theo reqId.
 * - Binary frame dùng cho chunk file (xử lý ở p2pService).
 *
 * Sự kiện: 'frame' (conn, frame), 'binary' (conn, Buffer), 'connected' (conn), 'disconnected' (conn).
 */
'use strict';

const { EventEmitter } = require('events');
const WebSocket = require('ws');
const { NETWORK, ERROR_CODE, LOG_CATEGORY, P2P_CHUNK_SIZE } = require('../../../shared/constants');
const { P2P } = require('../../../shared/wsEvents');
const { encodeFrame, decodeFrame } = require('../../../shared/serializer');
const { AppError } = require('../../core/utils/errors');
const { isAllowedPeerAddress, listIpv4Interfaces, normalizeRemoteAddress } = require('../../core/utils/net');

const HELLO_TIMEOUT_MS = 10000;
const CONNECT_TIMEOUT_MS = 5000;
const MAX_PAYLOAD = P2P_CHUNK_SIZE + 64 * 1024; // chunk 512KB + header

/** 1 kết nối P2P đã xác thực */
class PeerConnection {
  constructor(ws, opts) {
    this.ws = ws;
    this.direction = opts.direction; // 'in' | 'out'
    this.remoteAddress = opts.remoteAddress;
    this.instanceId = null;
    this.userId = null;
    this.claims = null;
    this.authenticated = false;
    this.pending = new Map();
    this.seq = 0;
  }

  isOpen() {
    return this.ws.readyState === WebSocket.OPEN;
  }

  /** Gửi frame JSON 1 chiều */
  send(type, data, extra) {
    if (!this.isOpen()) return false;
    this.ws.send(encodeFrame(type, data || {}, extra));
    return true;
  }

  /**
   * Request chờ frame trả lời cùng reqId.
   * @returns {Promise<{type, data}>}
   */
  request(type, data, timeoutMs) {
    if (!this.isOpen()) return Promise.reject(new AppError(ERROR_CODE.SERVER_OFFLINE, 'Peer đã ngắt kết nối'));
    this.seq += 1;
    const reqId = `p-${this.seq}-${Date.now().toString(36)}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(reqId);
        reject(new AppError(ERROR_CODE.TIMEOUT, 'Peer không phản hồi'));
      }, timeoutMs || NETWORK.REQUEST_TIMEOUT_MS);
      this.pending.set(reqId, { resolve, reject, timer });
      this.ws.send(encodeFrame(type, data || {}, { reqId }), (err) => {
        if (!err) return;
        clearTimeout(timer);
        this.pending.delete(reqId);
        reject(new AppError(ERROR_CODE.SERVER_OFFLINE, `Gửi tới peer thất bại: ${err.message}`));
      });
    });
  }

  /** Trả lời 1 request (cùng reqId) */
  reply(frame, type, data, error) {
    return this.send(type, data, { reqId: frame.reqId, error });
  }

  /**
   * Gửi binary, chờ buffer socket xả bớt (backpressure) để không dồn RAM với file lớn.
   * @param {Buffer} buf
   */
  sendBinary(buf) {
    return new Promise((resolve, reject) => {
      if (!this.isOpen()) {
        reject(new AppError(ERROR_CODE.SERVER_OFFLINE, 'Peer đã ngắt kết nối'));
        return;
      }
      this.ws.send(buf, { binary: true }, (err) => (err ? reject(err) : resolve()));
    });
  }

  /** Xử lý frame trả lời; true nếu đã khớp request */
  resolvePending(frame) {
    if (!frame.reqId || !this.pending.has(frame.reqId)) return false;
    const p = this.pending.get(frame.reqId);
    this.pending.delete(frame.reqId);
    clearTimeout(p.timer);
    if (frame.error) p.reject(new AppError(frame.error.code || ERROR_CODE.INTERNAL, frame.error.message || 'Peer báo lỗi'));
    else p.resolve(frame);
    return true;
  }

  failAll(err) {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
  }

  close(code, reason) {
    try {
      this.ws.close(code || 1000, reason || '');
    } catch (_err) {
      this.ws.terminate();
    }
  }
}

class P2PNode extends EventEmitter {
  /**
   * @param {{ port?: number, instanceId: string,
   *   getHello: () => ({session_token: string, vector_clock: object} | null),
   *   verifyToken: (token: string) => ({ok: boolean, claims?: object, code?: string}),
   *   getInterfaces?: () => Array<{address, netmask}>, logger: object }} opts
   */
  constructor(opts) {
    super();
    this.port = opts.port || NETWORK.P2P_PORT;
    this.instanceId = opts.instanceId;
    this.getHello = opts.getHello;
    this.verifyToken = opts.verifyToken;
    this.getInterfaces = opts.getInterfaces || (() => listIpv4Interfaces());
    this.log = opts.logger;
    this.wss = null;
    this.connections = new Map(); // instance_id → PeerConnection (đã auth)
    this.connecting = new Map(); // instance_id → Promise<PeerConnection>
    this.all = new Set();
  }

  /** Mở WS server :5002 */
  start() {
    return new Promise((resolve, reject) => {
      const wss = new WebSocket.Server({ port: this.port, maxPayload: MAX_PAYLOAD, perMessageDeflate: false });
      const onError = (err) => {
        wss.close();
        reject(err);
      };
      wss.once('error', onError);
      wss.once('listening', () => {
        wss.removeListener('error', onError);
        wss.on('error', (err) => this.log.error(LOG_CATEGORY.CONNECTION, 'p2p_server_error', { message: err.message }));
        this.wss = wss;
        resolve();
      });
      wss.on('connection', (ws, req) => this._onIncoming(ws, req));
    });
  }

  _onIncoming(ws, req) {
    const remote = normalizeRemoteAddress(req.socket.remoteAddress);
    if (!isAllowedPeerAddress(remote, this.getInterfaces())) {
      this.log.warn(LOG_CATEGORY.CONNECTION, 'p2p_rejected_subnet', { remote });
      ws.close(1008, 'subnet');
      return;
    }
    const conn = this._track(new PeerConnection(ws, { direction: 'in', remoteAddress: remote }));
    const helloTimer = setTimeout(() => {
      if (!conn.authenticated) conn.close(1008, 'hello-timeout');
    }, HELLO_TIMEOUT_MS);

    ws.on('message', (raw, isBinary) => {
      if (!conn.authenticated) {
        if (isBinary) return conn.close(1008, 'unauthenticated');
        const frame = decodeFrame(raw);
        if (!frame || frame.type !== P2P.HELLO) {
          conn.send(P2P.ERROR, { code: ERROR_CODE.UNAUTHORIZED, message: 'Cần p2p:hello trước' });
          return conn.close(1008, 'unauthenticated');
        }
        clearTimeout(helloTimer);
        this._acceptHello(conn, frame);
        return undefined;
      }
      return this._dispatch(conn, raw, isBinary);
    });
  }

  /** Bên nhận: verify token của bên kết nối, trả hello-ack kèm token của mình */
  _acceptHello(conn, frame) {
    const mine = this.getHello();
    const data = frame.data || {};
    const result = mine ? this.verifyToken(data.session_token) : { ok: false, code: ERROR_CODE.UNAUTHORIZED };
    if (!result.ok || !data.instance_id) {
      this.log.warn(LOG_CATEGORY.CONNECTION, 'p2p_hello_rejected', { remote: conn.remoteAddress, code: result.code });
      conn.reply(frame, P2P.ERROR, { code: ERROR_CODE.UNAUTHORIZED }, { code: ERROR_CODE.UNAUTHORIZED, message: 'Token P2P không hợp lệ' });
      conn.close(1008, 'unauthorized');
      return;
    }
    this._authenticate(conn, result.claims, String(data.instance_id), data.vector_clock);
    conn.reply(frame, P2P.HELLO_ACK, { session_token: mine.session_token, instance_id: this.instanceId, vector_clock: mine.vector_clock });
  }

  _authenticate(conn, claims, instanceId, vectorClock) {
    conn.authenticated = true;
    conn.claims = claims;
    conn.userId = Number(claims.uid);
    conn.instanceId = instanceId;
    const existing = this.connections.get(instanceId);
    if (!existing || !existing.isOpen()) this.connections.set(instanceId, conn);
    this.log.info(LOG_CATEGORY.CONNECTION, 'p2p_connected', { user_id: conn.userId, direction: conn.direction, remote: conn.remoteAddress });
    this.emit('connected', conn, vectorClock || {});
  }

  _track(conn) {
    this.all.add(conn);
    conn.ws.on('close', () => {
      this.all.delete(conn);
      conn.failAll(new AppError(ERROR_CODE.SERVER_OFFLINE, 'Peer đã ngắt kết nối'));
      if (conn.instanceId && this.connections.get(conn.instanceId) === conn) this.connections.delete(conn.instanceId);
      if (conn.authenticated) this.emit('disconnected', conn);
    });
    conn.ws.on('error', (err) => this.log.debug(LOG_CATEGORY.CONNECTION, 'p2p_socket_error', { message: err.message }));
    return conn;
  }

  _dispatch(conn, raw, isBinary) {
    if (isBinary) {
      this.emit('binary', conn, raw);
      return;
    }
    const frame = decodeFrame(raw);
    if (!frame) return;
    if (conn.resolvePending(frame)) return;
    this.emit('frame', conn, frame);
  }

  /**
   * Lấy kết nối sẵn có hoặc mở mới tới peer (dedupe theo instance_id).
   * @param {{instance_id, user_id, ip, port}} peer
   * @returns {Promise<PeerConnection>}
   */
  getOrConnect(peer) {
    const existing = this.connections.get(peer.instance_id);
    if (existing && existing.isOpen()) return Promise.resolve(existing);
    if (this.connecting.has(peer.instance_id)) return this.connecting.get(peer.instance_id);
    const p = this._connect(peer).finally(() => this.connecting.delete(peer.instance_id));
    this.connecting.set(peer.instance_id, p);
    return p;
  }

  _connect(peer) {
    return new Promise((resolve, reject) => {
      const mine = this.getHello();
      if (!mine) {
        reject(new AppError(ERROR_CODE.UNAUTHORIZED, 'Chưa đăng nhập — không thể kết nối P2P'));
        return;
      }
      if (!isAllowedPeerAddress(peer.ip, this.getInterfaces())) {
        reject(new AppError(ERROR_CODE.FORBIDDEN, 'Peer không cùng mạng LAN'));
        return;
      }
      const ws = new WebSocket(`ws://${peer.ip}:${peer.port}`, {
        handshakeTimeout: CONNECT_TIMEOUT_MS,
        maxPayload: MAX_PAYLOAD,
        perMessageDeflate: false,
      });
      const conn = this._track(new PeerConnection(ws, { direction: 'out', remoteAddress: peer.ip }));
      let settled = false;
      const fail = (err) => {
        if (settled) return;
        settled = true;
        conn.close(1008, 'handshake-failed');
        reject(err);
      };
      ws.on('error', (err) => fail(new AppError(ERROR_CODE.SERVER_OFFLINE, `Không kết nối được peer: ${err.message}`)));
      ws.on('close', () => fail(new AppError(ERROR_CODE.SERVER_OFFLINE, 'Peer đóng kết nối')));
      ws.on('message', (raw, isBinary) => this._dispatch(conn, raw, isBinary));
      ws.on('open', () => {
        conn
          .request(P2P.HELLO, { session_token: mine.session_token, instance_id: this.instanceId, vector_clock: mine.vector_clock }, HELLO_TIMEOUT_MS)
          .then((frame) => {
            const data = frame.data || {};
            const result = this.verifyToken(data.session_token);
            // Token phải hợp lệ VÀ đúng user mà peer đã announce (chống giả mạo announce)
            if (!result.ok || Number(result.claims.uid) !== Number(peer.user_id)) {
              this.log.warn(LOG_CATEGORY.CONNECTION, 'p2p_hello_ack_rejected', { remote: peer.ip, code: result.code });
              fail(new AppError(ERROR_CODE.UNAUTHORIZED, 'Peer trả token không hợp lệ'));
              return;
            }
            settled = true;
            this._authenticate(conn, result.claims, String(data.instance_id || peer.instance_id), data.vector_clock);
            resolve(conn);
          })
          .catch(fail);
      });
    });
  }

  /** Các kết nối đã auth tới 1 user */
  connectionsForUser(userId) {
    return Array.from(this.connections.values()).filter((c) => c.userId === Number(userId) && c.isOpen());
  }

  /** Đóng mọi kết nối (logout) — vẫn giữ server lắng nghe */
  closeAll() {
    for (const conn of this.all) conn.close(1001, 'logout');
    this.connections.clear();
  }

  /** Tắt hẳn (thoát app) */
  stop() {
    this.closeAll();
    return new Promise((resolve) => {
      if (!this.wss) return resolve();
      this.wss.close(() => resolve());
      this.wss = null;
      return undefined;
    });
  }
}

module.exports = { P2PNode, PeerConnection };
