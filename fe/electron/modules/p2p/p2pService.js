/**
 * Logic nhắn tin P2P khi server offline (spec 2.7.3–2.7.7, PROTOCOL §8).
 *
 * Gửi:
 *   - 1-1: peer nhận ACK → sync_state='pending_server', status='sent'; peer không online → giữ 'pending_peer'.
 *   - Nhóm: gửi tới mọi member đang online, ghi p2p_receipts {user_id: ts}; đủ hết → 'pending_server'+'sent',
 *     thiếu → 'partial_peer' (status vẫn pending); không ai nhận → 'pending_peer'.
 *   - Peer xuất hiện lại (UDP) → tự gửi lại các tin còn thiếu receipt của user đó.
 * Nhận: verify người gửi = user của kết nối, merge vector clock, lưu 'peer_synced', ACK.
 * File: chunk 512KB qua binary frame (36 byte transfer_id + uint32 BE index + data), ghép tại
 *   data/downloads-p2p/<sha256>/<tên>, verify SHA-256.
 * Nhóm tạo/đổi tên offline: p2p:conv-sync, giải xung đột LWW theo (updated_at, user_id).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  SYNC_STATE,
  MESSAGE_STATUS,
  MESSAGE_TYPE,
  CONVERSATION_TYPE,
  ERROR_CODE,
  LOG_CATEGORY,
  MAX_FILE_SIZE,
  P2P_CHUNK_SIZE,
  TEMP_CONVERSATION_PREFIX,
} = require('../../../shared/constants');
const { P2P } = require('../../../shared/wsEvents');
const { sanitizeFileName } = require('../../../shared/validators');
const { IPC_EVENTS } = require('../../../ipc/channels');
const { messageToWire, conversationToWire, memberIds } = require('../chat/wireBuilders');
const { sha256File, fileExists, isSha256 } = require('../../core/utils/files');
const { nowIso } = require('../../core/utils/time');

const TRANSFER_ID_LEN = 36;
const CHUNK_HEADER_LEN = TRANSFER_ID_LEN + 4;
const FILE_ACK_TIMEOUT_MS = 120000;
const UUID_REGEX = /^[0-9a-f-]{36}$/i;
const ALLOWED_P2P_TYPES = new Set([MESSAGE_TYPE.TEXT, MESSAGE_TYPE.IMAGE, MESSAGE_TYPE.FILE]);

/**
 * Tính trạng thái giao tin P2P từ receipts (pure — có test).
 * @param {{ isGroup: boolean, otherMemberIds: number[], receipts: Object<string, string> }} input
 * @returns {{ sync_state: string, status: string, delivered: number, total: number }}
 */
function computeDeliveryState(input) {
  const others = (input.otherMemberIds || []).map(Number);
  const receipts = input.receipts || {};
  const delivered = others.filter((id) => receipts[String(id)]).length;
  const total = others.length;
  if (total === 0 || delivered >= total || (!input.isGroup && delivered > 0)) {
    return { sync_state: SYNC_STATE.PENDING_SERVER, status: MESSAGE_STATUS.SENT, delivered, total };
  }
  if (delivered === 0) return { sync_state: SYNC_STATE.PENDING_PEER, status: MESSAGE_STATUS.PENDING, delivered, total };
  return { sync_state: SYNC_STATE.PARTIAL_PEER, status: MESSAGE_STATUS.PENDING, delivered, total };
}

/**
 * LWW: bản (updated_at, user_id) nào mới hơn thắng.
 * @returns {boolean} true nếu incoming thắng local
 */
function lwwWins(incoming, local) {
  if (!local) return true;
  const a = String(incoming.updated_at || '');
  const b = String(local.updated_at || '');
  if (a !== b) return a > b;
  return Number(incoming.user_id || 0) > Number(local.user_id || 0);
}

/** Dựng header chunk: transfer_id (36 byte ASCII) + chunk index uint32 BE */
function encodeChunk(transferId, index, data) {
  const header = Buffer.alloc(CHUNK_HEADER_LEN);
  header.write(transferId, 0, TRANSFER_ID_LEN, 'ascii');
  header.writeUInt32BE(index, TRANSFER_ID_LEN);
  return Buffer.concat([header, data]);
}

function decodeChunk(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < CHUNK_HEADER_LEN) return null;
  return {
    transferId: buf.toString('ascii', 0, TRANSFER_ID_LEN),
    index: buf.readUInt32BE(TRANSFER_ID_LEN),
    data: buf.subarray(CHUNK_HEADER_LEN),
  };
}

class P2PService {
  /**
   * @param {{ node: import('./p2pServer').P2PNode, registry: import('./peerRegistry').PeerRegistry, repos: object,
   *   view: object, ingest: object, session: object, clock: object, emit: Function, logger: object,
   *   paths: { P2P_DOWNLOADS: string } }} deps
   */
  constructor(deps) {
    Object.assign(this, {
      node: deps.node,
      registry: deps.registry,
      repos: deps.repos,
      view: deps.view,
      ingest: deps.ingest,
      session: deps.session,
      clock: deps.clock,
      emit: deps.emit,
      log: deps.logger,
      paths: deps.paths,
    });
    this.inFlight = new Set(); // client_message_id đang gửi P2P
    this.incoming = new Map(); // transfer_id → trạng thái nhận file
    this.retryChain = Promise.resolve();
  }

  /** Gắn handler vào tầng vận chuyển + registry */
  attach() {
    this.node.on('frame', (conn, frame) => this._onFrame(conn, frame).catch((err) => this._logErr('p2p_frame_failed', err, frame.type)));
    this.node.on('binary', (conn, buf) => this._onBinary(conn, buf));
    this.node.on('disconnected', (conn) => this._dropTransfers(conn));
    this.registry.on('peer-added', (peer) => this.onPeerAvailable(peer));
    this.registry.on('peer-updated', (peer) => this.onPeerAvailable(peer));
  }

  /** P2P chỉ dùng để GỬI khi đã đăng nhập mà server offline */
  isSendingActive() {
    return this.session.isLoggedIn() && !this.session.isOnline();
  }

  _logErr(action, err, extra) {
    this.log.warn(LOG_CATEGORY.MESSAGE, action, { code: err && err.code, message: err && err.message, extra });
  }

  // ======================= GỬI =======================

  /**
   * Gửi 1 tin của mình tới các member đang online (bỏ qua member đã có receipt).
   * @param {string} cmid
   * @returns {Promise<object|null>} row sau cập nhật
   */
  async sendMessage(cmid) {
    if (this.inFlight.has(cmid)) return null;
    this.inFlight.add(cmid);
    try {
      return await this._sendMessage(cmid);
    } finally {
      this.inFlight.delete(cmid);
    }
  }

  async _sendMessage(cmid) {
    const msg = this.repos.messages.get(cmid);
    if (!msg) return null;
    const conv = this.repos.conversations.get(msg.conversation_id);
    if (!conv) return msg;
    const myId = this.session.getUserId();
    const others = memberIds(conv).filter((id) => id !== Number(myId));
    const receipts = { ...(msg.p2p_receipts || {}) };
    const wire = messageToWire(msg);
    const convWire = conversationToWire(conv);

    for (const userId of others) {
      if (receipts[String(userId)]) continue;
      for (const peer of this.registry.getByUserId(userId)) {
        try {
          const conn = await this.node.getOrConnect(peer);
          if (msg.file && msg.file.sha256 && msg.local_path && fileExists(msg.local_path)) {
            await this.sendFile(conn, msg);
          }
          const ack = await conn.request(P2P.MESSAGE, { message: wire, conversation: convWire });
          receipts[String(userId)] = (ack.data && ack.data.received_at) || nowIso();
          break; // 1 instance của user nhận là đủ
        } catch (err) {
          this._logErr('p2p_send_failed', err, { user_id: userId });
        }
      }
    }

    const state = computeDeliveryState({ isGroup: conv.type === CONVERSATION_TYPE.GROUP, otherMemberIds: others, receipts });
    const current = this.repos.messages.get(cmid);
    // Server có thể đã nhận tin trong lúc gửi P2P → không hạ sync_state 'synced'
    if (current && current.sync_state !== SYNC_STATE.SYNCED) {
      this.repos.messages.update(cmid, { p2p_receipts: receipts, sync_state: state.sync_state, status: state.status });
    } else if (current) {
      this.repos.messages.update(cmid, { p2p_receipts: receipts });
    }
    this.view.emitMessage(cmid);
    return this.repos.messages.get(cmid);
  }

  /**
   * Gửi file theo chunk 512KB rồi chờ file-ack.
   * @param {import('./p2pServer').PeerConnection} conn
   * @param {object} msg row có file + local_path
   */
  async sendFile(conn, msg) {
    const file = msg.file;
    const stat = fs.statSync(msg.local_path);
    const transferId = crypto.randomUUID();
    const totalChunks = Math.ceil(stat.size / P2P_CHUNK_SIZE);
    conn.send(P2P.FILE_START, {
      transfer_id: transferId,
      sha256: file.sha256,
      name: file.name,
      size: stat.size,
      mime_type: file.mime_type,
      chunk_size: P2P_CHUNK_SIZE,
      total_chunks: totalChunks,
      client_message_id: msg.client_message_id,
    });
    const fd = fs.openSync(msg.local_path, 'r');
    try {
      const buf = Buffer.alloc(P2P_CHUNK_SIZE);
      for (let i = 0; i < totalChunks; i += 1) {
        const n = fs.readSync(fd, buf, 0, P2P_CHUNK_SIZE, i * P2P_CHUNK_SIZE);
        await conn.sendBinary(encodeChunk(transferId, i, buf.subarray(0, n)));
      }
    } finally {
      fs.closeSync(fd);
    }
    const ack = await conn.request(P2P.FILE_COMPLETE, { transfer_id: transferId }, FILE_ACK_TIMEOUT_MS);
    if (!ack.data || !ack.data.ok) {
      throw Object.assign(new Error((ack.data && ack.data.error) || 'Peer báo lỗi nhận file'), { code: ERROR_CODE.INTERNAL });
    }
    this.log.info(LOG_CATEGORY.FILE, 'p2p_file_sent', { sha256: file.sha256, size: stat.size, to: conn.userId });
  }

  /**
   * Peer xuất hiện/đổi trạng thái → gửi lại tin còn thiếu + đồng bộ nhóm offline (tuần tự, không chồng chéo).
   * @param {{user_id: number}} peer
   */
  onPeerAvailable(peer) {
    if (!this.isSendingActive()) return;
    this.retryChain = this.retryChain
      .then(() => this._retryForUser(peer.user_id))
      .catch((err) => this._logErr('p2p_retry_failed', err, { user_id: peer.user_id }));
  }

  async _retryForUser(userId) {
    const myId = this.session.getUserId();
    if (!myId || Number(userId) === Number(myId)) return;
    // Nhóm tạo/đổi tên offline mà peer là member → gửi conv-sync trước
    for (const conv of this.repos.conversations.listBySyncState(SYNC_STATE.PENDING_SERVER)) {
      if (memberIds(conv).includes(Number(userId))) await this.syncConversationTo(conv, userId);
    }
    for (const msg of this.repos.messages.listAwaitingPeers(myId)) {
      if (!this.isSendingActive()) return;
      if ((msg.p2p_receipts || {})[String(userId)]) continue;
      const conv = this.repos.conversations.get(msg.conversation_id);
      if (conv && memberIds(conv).includes(Number(userId))) await this.sendMessage(msg.client_message_id);
    }
  }

  /** Gửi conv-sync cho mọi instance online của 1 user */
  async syncConversationTo(conv, userId) {
    for (const peer of this.registry.getByUserId(userId)) {
      try {
        const conn = await this.node.getOrConnect(peer);
        conn.send(P2P.CONV_SYNC, { conversation: conversationToWire(conv) });
      } catch (err) {
        this._logErr('p2p_conv_sync_failed', err, { user_id: userId });
      }
    }
  }

  /**
   * Gửi 1 frame tới mọi member (khác mình) đang online của conversation — fire-and-forget.
   * @param {object} conv
   * @param {string} type
   * @param {object} data
   */
  async broadcastToMembers(conv, type, data) {
    const myId = Number(this.session.getUserId());
    const targets = memberIds(conv).filter((id) => id !== myId);
    await Promise.all(
      targets.flatMap((uid) =>
        this.registry.getByUserId(uid).map((peer) =>
          this.node
            .getOrConnect(peer)
            .then((conn) => conn.send(type, data))
            .catch((err) => this._logErr('p2p_broadcast_failed', err, { type, user_id: uid })),
        ),
      ),
    );
  }

  /** Đồng bộ nhóm (tạo/đổi tên offline) tới mọi member online */
  syncConversation(conv) {
    return this.broadcastToMembers(conv, P2P.CONV_SYNC, { conversation: conversationToWire(conv) });
  }

  sendTyping(conv) {
    const me = this.session.getUser();
    if (!me) return Promise.resolve();
    return this.broadcastToMembers(conv, P2P.TYPING, { conversation_id: String(conv.id), user_id: me.id, display_name: me.display_name });
  }

  // ======================= NHẬN =======================

  async _onFrame(conn, frame) {
    const data = frame.data || {};
    switch (frame.type) {
      case P2P.MESSAGE:
        return this._onMessage(conn, frame, data);
      case P2P.MESSAGE_EDIT:
        return this._onEdit(conn, data);
      case P2P.MESSAGE_RECALL:
        return this._onRecall(conn, data);
      case P2P.TYPING:
        if (Number(data.user_id) === conn.userId) {
          this.emit(IPC_EVENTS.TYPING, { conversation_id: String(data.conversation_id), user_id: conn.userId, display_name: data.display_name || '' });
        }
        return undefined;
      case P2P.PRESENCE:
        return undefined; // presence peer đã có qua UDP registry
      case P2P.CONV_SYNC:
        return this._onConvSync(conn, data);
      case P2P.FILE_START:
        return this._onFileStart(conn, data);
      case P2P.FILE_COMPLETE:
        return this._onFileComplete(conn, frame, data);
      default:
        return undefined;
    }
  }

  /** Chỉ chấp nhận khi mình là member của conversation */
  _isMember(conv, userId) {
    return !!conv && memberIds(conv).includes(Number(userId));
  }

  async _onMessage(conn, frame, data) {
    const m = data.message || {};
    const reject = (code, message) => conn.reply(frame, P2P.MESSAGE_ACK, { client_message_id: m.client_message_id }, { code, message });
    if (typeof m.client_message_id !== 'string' || !UUID_REGEX.test(m.client_message_id) || !m.conversation_id) {
      return reject(ERROR_CODE.VALIDATION, 'Tin P2P không hợp lệ');
    }
    // Peer chỉ được gửi tin của CHÍNH mình (token đã verify) — chống giả mạo người gửi
    if (Number(m.sender_id) !== conn.userId || !ALLOWED_P2P_TYPES.has(m.type)) {
      return reject(ERROR_CODE.FORBIDDEN, 'Người gửi không hợp lệ');
    }
    const myId = this.session.getUserId();
    let conv = this.repos.conversations.get(String(m.conversation_id));
    if (!conv && data.conversation && String(data.conversation.id) === String(m.conversation_id)) {
      if (!this._isMember(data.conversation, myId) || !this._isMember(data.conversation, conn.userId)) {
        return reject(ERROR_CODE.FORBIDDEN, 'Không phải thành viên');
      }
      const isTemp = String(data.conversation.id).startsWith(TEMP_CONVERSATION_PREFIX);
      conv = this.repos.conversations.upsertFromWire(data.conversation, {
        sync_state: isTemp ? SYNC_STATE.PEER_SYNCED : SYNC_STATE.SYNCED,
        updated_by: conn.userId,
      });
    }
    if (!conv || !this._isMember(conv, myId) || !this._isMember(conv, conn.userId)) {
      return reject(ERROR_CODE.FORBIDDEN, 'Không phải thành viên');
    }

    this.clock.merge(m.vector_clock);
    const sha = m.file && isSha256(m.file.sha256) ? m.file.sha256 : null;
    const p2pFile = sha ? this.repos.p2pFiles.get(sha) : null;
    const { inserted, message } = this.repos.messages.insert({
      ...m,
      conversation_id: String(m.conversation_id),
      server_id: null,
      edited: !!m.edited,
      recalled: !!m.recalled,
      status: MESSAGE_STATUS.SENT,
      sync_state: SYNC_STATE.PEER_SYNCED,
      local_path: p2pFile && fileExists(p2pFile.local_path) ? p2pFile.local_path : null,
    });
    conn.reply(frame, P2P.MESSAGE_ACK, { client_message_id: m.client_message_id, received_at: nowIso() });
    if (inserted) this.log.info(LOG_CATEGORY.MESSAGE, 'p2p_message_received', { from: conn.userId, conversation_id: m.conversation_id });
    this.ingest.afterIncoming(message, inserted);
    return undefined;
  }

  _onEdit(conn, data) {
    const msg = this.repos.messages.get(String(data.client_message_id || ''));
    if (!msg || msg.sender_id !== conn.userId || msg.recalled || msg.type !== MESSAGE_TYPE.TEXT) return;
    const updatedAt = data.updated_at || nowIso();
    if (msg.updated_at && msg.updated_at >= updatedAt) return; // bản local mới hơn
    this.repos.messages.update(msg.client_message_id, { content: String(data.content || ''), edited: true, updated_at: updatedAt });
    this.view.emitMessage(msg.client_message_id);
  }

  _onRecall(conn, data) {
    const msg = this.repos.messages.get(String(data.client_message_id || ''));
    if (!msg || msg.sender_id !== conn.userId || msg.recalled) return;
    this.repos.messages.update(msg.client_message_id, { recalled: true, content: '', updated_at: nowIso() });
    this.view.emitMessage(msg.client_message_id);
    this.view.emitConversation(msg.conversation_id);
  }

  /** Nhóm tạo/đổi tên offline từ peer — LWW theo (updated_at, user_id) */
  _onConvSync(conn, data) {
    const wire = data.conversation;
    if (!wire || !wire.id) return;
    const myId = this.session.getUserId();
    if (!this._isMember(wire, myId) || !this._isMember(wire, conn.userId)) return;
    const local = this.repos.conversations.get(String(wire.id));
    const isTemp = String(wire.id).startsWith(TEMP_CONVERSATION_PREFIX);
    if (!local) {
      this.repos.conversations.upsertFromWire(wire, { sync_state: isTemp ? SYNC_STATE.PEER_SYNCED : SYNC_STATE.SYNCED, updated_by: conn.userId });
    } else {
      const incoming = { updated_at: wire.updated_at, user_id: conn.userId };
      const current = { updated_at: local.updated_at, user_id: local.updated_by };
      if (!lwwWins(incoming, current)) return;
      this.repos.conversations.applyRename(local.id, {
        name: wire.name,
        version: Math.max(Number(wire.version) || 1, Number(local.version) || 1),
        updated_at: wire.updated_at,
        updated_by: conn.userId,
        sync_state: local.sync_state,
      });
    }
    this.view.emitConversation(String(wire.id));
  }

  // ---------- nhận file ----------

  _onFileStart(conn, d) {
    const totalExpected = Math.ceil(Number(d.size) / P2P_CHUNK_SIZE);
    const valid =
      typeof d.transfer_id === 'string' && UUID_REGEX.test(d.transfer_id) && isSha256(d.sha256) &&
      Number.isInteger(Number(d.size)) && Number(d.size) >= 0 && Number(d.size) <= MAX_FILE_SIZE &&
      Number(d.chunk_size) === P2P_CHUNK_SIZE && Number(d.total_chunks) === totalExpected;
    if (!valid) {
      this.log.warn(LOG_CATEGORY.FILE, 'p2p_file_start_invalid', { from: conn.userId });
      return;
    }
    const dir = path.join(this.paths.P2P_DOWNLOADS, d.sha256);
    const existing = this.repos.p2pFiles.get(d.sha256);
    const already = !!(existing && fileExists(existing.local_path));
    const state = {
      conn,
      sha256: d.sha256,
      name: sanitizeFileName(d.name),
      size: Number(d.size),
      mime_type: String(d.mime_type || ''),
      total: totalExpected,
      received: new Set(),
      already,
      dir,
      partPath: path.join(dir, `.${d.transfer_id}.part`),
      fd: null,
      client_message_id: d.client_message_id || null,
    };
    if (!already) {
      fs.mkdirSync(dir, { recursive: true });
      state.fd = fs.openSync(state.partPath, 'w');
    }
    this.incoming.set(d.transfer_id, state);
  }

  _onBinary(conn, buf) {
    const chunk = decodeChunk(buf);
    if (!chunk) return;
    const t = this.incoming.get(chunk.transferId);
    if (!t || t.conn !== conn || chunk.index >= t.total) return;
    if (t.already) {
      t.received.add(chunk.index);
      return;
    }
    try {
      fs.writeSync(t.fd, chunk.data, 0, chunk.data.length, chunk.index * P2P_CHUNK_SIZE);
      t.received.add(chunk.index);
    } catch (err) {
      this._logErr('p2p_chunk_write_failed', err);
    }
  }

  async _onFileComplete(conn, frame, d) {
    const t = this.incoming.get(String(d.transfer_id || ''));
    const ack = (ok, error) => conn.reply(frame, P2P.FILE_ACK, { transfer_id: d.transfer_id, sha256: t && t.sha256, ok, ...(error ? { error } : {}) });
    if (!t || t.conn !== conn) return ack(false, 'Không tìm thấy phiên truyền file');
    this.incoming.delete(d.transfer_id);
    if (t.already) return ack(true);
    try {
      fs.closeSync(t.fd);
      t.fd = null;
      if (t.received.size !== t.total) throw new Error(`Thiếu chunk (${t.received.size}/${t.total})`);
      const hash = await sha256File(t.partPath);
      if (hash !== t.sha256) throw new Error('Sai SHA-256 — file bị lỗi khi truyền');
      const finalPath = path.join(t.dir, t.name);
      await fs.promises.rename(t.partPath, finalPath);
      this.repos.p2pFiles.upsert({
        file_hash: t.sha256,
        local_path: finalPath,
        file_size: t.size,
        mime_type: t.mime_type,
        received_from_user_id: conn.userId,
      });
      this.repos.messages.setLocalPathBySha(t.sha256, finalPath);
      this.log.info(LOG_CATEGORY.FILE, 'p2p_file_received', { sha256: t.sha256, size: t.size, from: conn.userId });
      return ack(true);
    } catch (err) {
      this._logErr('p2p_file_receive_failed', err);
      await fs.promises.unlink(t.partPath).catch(() => {});
      return ack(false, err.message);
    }
  }

  _dropTransfers(conn) {
    for (const [id, t] of this.incoming) {
      if (t.conn !== conn) continue;
      this.incoming.delete(id);
      if (t.fd !== null) {
        try {
          fs.closeSync(t.fd);
        } catch (_err) {
          /* đã đóng */
        }
        fs.promises.unlink(t.partPath).catch(() => {});
      }
    }
  }
}

module.exports = { P2PService, computeDeliveryState, lwwWins, encodeChunk, decodeChunk };
