/**
 * Đồng bộ (reconciliation) phía client khi WS tới server mở lại + auth OK (PROTOCOL §5).
 *
 * Thứ tự: pull (sync:request) → action conv_create (lấy id thật, remap temp→real) → action conv_rename
 *   → file (sync:file-batch + upload file thiếu) → tin nhắn (sync:message-batch, ≤100/lô)
 *   → action message_edit/message_recall (chạy SAU tin nhắn để tin tạo offline đã tồn tại trên server)
 *   → sync:ack. Conflict → giữ bản server, log warn. Tiến trình qua evt:sync-progress; kết thúc evt:sync-done + toast.
 *
 * Không import Electron; `request` được inject (sessionService.request).
 */
'use strict';

const fs = require('fs');
const {
  SYNC_STATE,
  MESSAGE_STATUS,
  ERROR_CODE,
  LOG_CATEGORY,
  ACTION_TYPE,
  TEMP_CONVERSATION_PREFIX,
} = require('../../../shared/constants');
const { SYNC, MESSAGE } = require('../../../shared/wsEvents');
const { IPC_EVENTS } = require('../../../ipc/channels');
const { forwardStatus } = require('../chat/messageRepo');
const { applyServerConversation, remapConversationId } = require('../chat/inboundService');
const { fileExists, mimeFromName } = require('../../core/utils/files');

const MESSAGE_BATCH_SIZE = 100;
const ACTION_BATCH_SIZE = 50;
const FILE_BATCH_SIZE = 50;
const MAX_ACTION_RETRY = 5;
const MAX_SYNC_ROWS = 100000;
const SYNC_TIMEOUT_MS = 60000;
/** Lỗi không thể tự hết khi thử lại → bỏ action */
const PERMANENT_ERRORS = new Set([ERROR_CODE.FORBIDDEN, ERROR_CODE.NOT_FOUND, ERROR_CODE.VALIDATION]);

const PHASE = Object.freeze({ PULL: 'pull', ACTIONS: 'actions', FILES: 'files', MESSAGES: 'messages' });

/** Chia mảng thành các lô */
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Dựng item sync:message-batch từ row local (pure — có test).
 * @param {object[]} rows
 * @param {Object<string, number>} fileIdBySha
 */
function buildMessageBatchItems(rows, fileIdBySha) {
  return rows.map((row) => {
    const item = {
      client_message_id: row.client_message_id,
      conversation_id: String(row.conversation_id),
      sender_id: row.sender_id,
      type: row.type,
      content: row.recalled ? '' : row.content || '',
      reply_to: row.reply_to || null,
      mentions: row.mentions || [],
      vector_clock: row.vector_clock || {},
      created_at_local: row.created_at_local || null,
    };
    if (row.file) {
      const sha = row.file.sha256 || row.file_sha256 || null;
      if (sha) item.file_sha256 = sha;
      const fileId = row.file.id || (sha && fileIdBySha ? fileIdBySha[sha] : null);
      if (fileId) item.file_id = fileId;
    }
    return item;
  });
}

/**
 * Chia tin chưa sync thành các lô ≤ MESSAGE_BATCH_SIZE (pure — có test).
 */
function buildMessageBatches(rows, fileIdBySha, batchSize) {
  return chunk(buildMessageBatchItems(rows, fileIdBySha), batchSize || MESSAGE_BATCH_SIZE);
}

class SyncService {
  /**
   * @param {{ request: (type: string, data: object, opts?: object) => Promise<any>, send?: Function,
   *   repos: object, view: object, emit: Function, logger: object, files?: object,
   *   getMyUserId: () => number|null }} deps
   */
  constructor(deps) {
    Object.assign(this, {
      request: deps.request,
      send: deps.send || (() => false),
      repos: deps.repos,
      view: deps.view,
      emit: deps.emit,
      log: deps.logger,
      files: deps.files || null,
      getMyUserId: deps.getMyUserId,
    });
  }

  _req(type, data) {
    return this.request(type, data, { timeoutMs: SYNC_TIMEOUT_MS });
  }

  _progress(phase, done, total) {
    this.emit(IPC_EVENTS.SYNC_PROGRESS, { phase, done, total });
  }

  /**
   * Chạy toàn bộ quy trình. Lỗi mạng giữa chừng → throw (lần authenticated sau sẽ chạy lại; idempotent).
   * @returns {Promise<{messages: number, files: number, conflicts: number}>}
   */
  async run() {
    const stats = { messages: 0, files: 0, conflicts: 0 };
    const startedAt = Date.now();
    await this.pull();
    await this.pushActions([ACTION_TYPE.CONV_CREATE], stats);
    await this.pushActions([ACTION_TYPE.CONV_RENAME], stats);
    const fileIdBySha = await this.pushFiles(stats);
    await this.pushMessages(fileIdBySha, stats);
    await this.pushActions([ACTION_TYPE.MESSAGE_EDIT, ACTION_TYPE.MESSAGE_RECALL], stats);
    this.send(SYNC.ACK, { last_server_id: this.repos.messages.maxServerId() });

    this.emit(IPC_EVENTS.SYNC_DONE, stats);
    if (stats.messages || stats.files) {
      this.emit(IPC_EVENTS.TOAST, { kind: 'success', text: `Đã đồng bộ ${stats.messages} tin, ${stats.files} file` });
    }
    this.log.info(LOG_CATEGORY.CONNECTION, 'sync_done', { ...stats, ms: Date.now() - startedAt });
    return stats;
  }

  /** Bước 1: kéo dữ liệu mới từ server, upsert local, gửi delivered */
  async pull() {
    const myId = this.getMyUserId();
    const known = this.repos.conversations
      .list()
      .map((c) => c.id)
      .filter((id) => !String(id).startsWith(TEMP_CONVERSATION_PREFIX));
    this._progress(PHASE.PULL, 0, 1);
    const res = await this._req(SYNC.REQUEST, { since_server_id: this.repos.messages.maxServerId(), known_conversation_ids: known });
    const remaps = [];
    const touchedConvs = new Set();
    const changedMessages = [];
    this.repos.transaction(() => {
      this.repos.users.upsertMany(res.users || []);
      for (const wire of res.conversations || []) {
        const { remappedFrom } = applyServerConversation(this.repos, wire);
        if (remappedFrom) remaps.push({ old_id: remappedFrom, new_id: String(wire.id) });
        touchedConvs.add(String(wire.id));
      }
      for (const id of res.deleted_conversation_ids || []) {
        this.repos.messages.deleteByConversation(id);
        this.repos.conversations.remove(id);
      }
      for (const wire of res.messages || []) {
        this.repos.messages.upsertFromServer(wire);
        this.repos.conversations.touchLastMessage(wire.conversation_id, wire.created_at);
        touchedConvs.add(String(wire.conversation_id));
        changedMessages.push(wire.client_message_id);
      }
      // Unread chính xác theo con trỏ đã đọc của mình trên server
      for (const id of touchedConvs) {
        const conv = this.repos.conversations.get(id);
        const me = conv && conv.members.find((m) => Number(m.user_id) === Number(myId));
        if (me) this.repos.conversations.setUnread(id, this.repos.messages.countIncomingAfter(id, myId, me.last_read_message_id || 0));
      }
    });

    for (const r of remaps) this.emit(IPC_EVENTS.CONVERSATION_ID_CHANGED, r);
    for (const id of res.deleted_conversation_ids || []) this.view.emitConversationRemoved(id);
    this.view.emitUsers(this.repos.users.list());
    for (const id of touchedConvs) {
      this.view.emitConversation(id);
      const latest = this.repos.messages.maxServerIdInConversation(id);
      if (latest) this.send(MESSAGE.DELIVERED, { conversation_id: id, server_id: latest });
    }
    for (const cmid of changedMessages) this.view.emitMessage(cmid);
    this._progress(PHASE.PULL, 1, 1);
    this.log.info(LOG_CATEGORY.CONNECTION, 'sync_pull', { messages: changedMessages.length, conversations: touchedConvs.size });
  }

  /**
   * Đẩy action_queue theo loại.
   * @param {string[]} types
   * @param {{conflicts: number}} stats
   */
  async pushActions(types, stats) {
    const actions = this.repos.actions.list(types);
    if (!actions.length) return;
    let done = 0;
    for (const batch of chunk(actions, ACTION_BATCH_SIZE)) {
      const res = await this._req(SYNC.ACTION_BATCH, {
        actions: batch.map((a) => ({
          client_action_id: a.client_action_id,
          action_type: a.action_type,
          payload: a.payload,
          vector_clock: a.vector_clock,
          created_at: a.created_at,
        })),
      });
      const byId = new Map(((res && res.results) || []).map((r) => [r.client_action_id, r]));
      for (const action of batch) {
        this._applyActionResult(action, byId.get(action.client_action_id), stats);
      }
      done += batch.length;
      this._progress(PHASE.ACTIONS, done, actions.length);
    }
  }

  _applyActionResult(action, result, stats) {
    if (!result) {
      this.repos.actions.markFailed(action.id, 'no_result');
      return;
    }
    const conv = result.result && result.result.conversation;
    if (result.ok || result.conflict) {
      if (result.conflict) {
        stats.conflicts += 1;
        this.log.warn(LOG_CATEGORY.CONNECTION, 'sync_conflict_keep_server', { action_type: action.action_type, payload_id: action.payload.conversation_id || action.payload.client_temp_id });
      }
      if (conv) {
        // conv_create: server trả id thật → remap temp → real trên mọi bảng
        const tempId = action.action_type === ACTION_TYPE.CONV_CREATE ? action.payload.client_temp_id : null;
        const { remappedFrom } = applyServerConversation(this.repos, { ...conv, client_temp_id: conv.client_temp_id || tempId });
        if (remappedFrom) this.emit(IPC_EVENTS.CONVERSATION_ID_CHANGED, { old_id: remappedFrom, new_id: String(conv.id) });
        this.view.emitConversation(conv.id);
      } else if (action.payload.conversation_id && action.action_type === ACTION_TYPE.CONV_RENAME) {
        this.repos.conversations.setSyncState(action.payload.conversation_id, SYNC_STATE.SYNCED);
      }
      this.repos.actions.remove(action.id);
      return;
    }
    const err = result.error || {};
    if (PERMANENT_ERRORS.has(err.code) || action.retry_count + 1 >= MAX_ACTION_RETRY) {
      this.log.warn(LOG_CATEGORY.CONNECTION, 'sync_action_dropped', { action_type: action.action_type, code: err.code, message: err.message });
      this.repos.actions.remove(action.id);
    } else {
      this.repos.actions.markFailed(action.id, err.message || err.code);
    }
  }

  /**
   * Bước file: báo server danh sách hash, upload file server còn thiếu (từ đường dẫn gốc / downloads-p2p).
   * @returns {Promise<Object<string, number>>} sha256 → file_id
   */
  async pushFiles(stats) {
    const myId = this.getMyUserId();
    const fileIdBySha = {};
    const pendingRows = this.repos.messages.listForSync(myId, MAX_SYNC_ROWS).filter((r) => r.file && !r.file.id && r.file.sha256);
    const bySha = new Map();
    for (const r of pendingRows) if (!bySha.has(r.file.sha256)) bySha.set(r.file.sha256, r);
    if (!bySha.size) return fileIdBySha;

    const rowsBySha = (sha) => pendingRows.filter((r) => r.file.sha256 === sha);
    const entries = Array.from(bySha.values());
    let done = 0;
    for (const batch of chunk(entries, FILE_BATCH_SIZE)) {
      const res = await this._req(SYNC.FILE_BATCH, {
        files: batch.map((r) => ({ sha256: r.file.sha256, size: r.file.size, name: r.file.name, mime_type: r.file.mime_type })),
      });
      for (const ex of (res && res.existing) || []) {
        if (!ex.file) continue;
        fileIdBySha[ex.sha256] = ex.file.id;
        for (const r of rowsBySha(ex.sha256)) this.repos.messages.update(r.client_message_id, { file: ex.file });
      }
      for (const sha of (res && res.missing) || []) {
        const row = bySha.get(sha);
        const source = this._localSource(row);
        if (!row || !source || !this.files) {
          this.log.warn(LOG_CATEGORY.FILE, 'sync_file_source_missing', { sha256: sha });
          continue;
        }
        try {
          const size = fs.statSync(source).size;
          const wireFile = await this.files.uploadRaw({
            filePath: source,
            size,
            name: row.file.name,
            mimeType: row.file.mime_type || mimeFromName(row.file.name),
          });
          fileIdBySha[sha] = wireFile.id;
          this.repos.p2pFiles.markUploaded(sha);
          for (const r of rowsBySha(sha)) this.repos.messages.update(r.client_message_id, { file: wireFile });
          stats.files += 1;
        } catch (err) {
          if (err.code === ERROR_CODE.SERVER_OFFLINE || err.code === ERROR_CODE.TIMEOUT) throw err;
          this.log.warn(LOG_CATEGORY.FILE, 'sync_file_upload_failed', { sha256: sha, code: err.code, message: err.message });
        }
      }
      done += batch.length;
      this._progress(PHASE.FILES, done, entries.length);
    }
    return fileIdBySha;
  }

  _localSource(row) {
    if (!row) return null;
    if (row.local_path && fileExists(row.local_path)) return row.local_path;
    return this.files ? this.files.findLocalCopy(row.file.sha256) : null;
  }

  /** Bước tin nhắn: lô ≤100, ack → gán server_id, re-key sort_key, sync_state='synced' */
  async pushMessages(fileIdBySha, stats) {
    const myId = this.getMyUserId();
    const rows = this.repos.messages.listForSync(myId, MAX_SYNC_ROWS);
    if (!rows.length) return;
    let done = 0;
    for (const batchRows of chunk(rows, MESSAGE_BATCH_SIZE)) {
      const items = buildMessageBatchItems(batchRows, fileIdBySha);
      const res = await this._req(SYNC.MESSAGE_BATCH, { messages: items });
      const byId = new Map(((res && res.results) || []).map((r) => [r.client_message_id, r]));
      for (const row of batchRows) {
        if (this._applyMessageResult(row, byId.get(row.client_message_id), stats)) this.view.emitMessage(row.client_message_id);
      }
      done += batchRows.length;
      this._progress(PHASE.MESSAGES, done, rows.length);
    }
  }

  /** @returns {boolean} có thay đổi row không */
  _applyMessageResult(row, result, stats) {
    if (!result) return false;
    const accepted = result.ok || result.status === 'ok' || result.status === 'conflict';
    if (accepted && result.server_id) {
      if (result.status === 'conflict') {
        stats.conflicts += 1;
        this.log.warn(LOG_CATEGORY.MESSAGE, 'sync_message_conflict_keep_server', { client_message_id: row.client_message_id });
      }
      const existing = this.repos.messages.getByServerId(result.server_id);
      if (existing && existing.client_message_id !== row.client_message_id) {
        // Hiếm: server_id đã gắn cho row khác → giữ bản server, bỏ bản local trùng
        this.log.warn(LOG_CATEGORY.MESSAGE, 'sync_server_id_collision', { server_id: result.server_id });
        return false;
      }
      this.repos.messages.update(row.client_message_id, {
        server_id: result.server_id,
        created_at: result.created_at || row.created_at,
        sync_state: SYNC_STATE.SYNCED,
        status: forwardStatus(row.status === MESSAGE_STATUS.FAILED ? MESSAGE_STATUS.PENDING : row.status, MESSAGE_STATUS.SENT),
        last_error: null,
      });
      if (Number(row.sender_id) === Number(this.getMyUserId())) stats.messages += 1;
      return true;
    }
    const err = result.error || {};
    if (err.code === ERROR_CODE.CONV_NOT_SYNCED) return false; // giữ lại, thử lần sau
    this.log.warn(LOG_CATEGORY.MESSAGE, 'sync_message_rejected', { client_message_id: row.client_message_id, code: err.code });
    this.repos.messages.update(row.client_message_id, { last_error: err.message || err.code || 'sync_error' });
    return true;
  }
}

module.exports = { SyncService, buildMessageBatches, buildMessageBatchItems, chunk, remapConversationId, PHASE };
