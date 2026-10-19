/**
 * Nghiệp vụ chat phía client: gửi/sửa/thu hồi/ghim, đọc, typing, tạo/đổi tên nhóm, hành động nhóm.
 * Main tự chọn đường: server online → WS; offline → P2P (+ action_queue để sync sau).
 *
 * Mọi tin gửi đi: tạo bản local trước (client_message_id = UUID, vector clock++, created_at_local),
 * đẩy evt:message ngay, rồi mới gửi (idempotent theo client_message_id).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  MESSAGE_TYPE,
  MESSAGE_STATUS,
  SYNC_STATE,
  CONVERSATION_TYPE,
  GROUP_ROLE,
  ERROR_CODE,
  LOG_CATEGORY,
  MAX_FILE_SIZE,
  MIN_GROUP_OTHER_MEMBERS,
  PAGE_SIZE,
  IMAGE_MIME_PREFIX,
  TEMP_CONVERSATION_PREFIX,
  ACTION_TYPE,
} = require('../../../shared/constants');
const { MESSAGE, CONV, TYPING, P2P } = require('../../../shared/wsEvents');
const validators = require('../../../shared/validators');
const { GROUP_ACTION } = require('../../../ipc/channels');
const { AppError, validationError, offlineError } = require('../../core/utils/errors');
const { mimeFromName, sha256File, sha256Buffer, fileExists, EXT_BY_MIME } = require('../../core/utils/files');
const { nowIso } = require('../../core/utils/time');
const { memberIds } = require('./wireBuilders');

/** Lỗi mạng → thử đường P2P/queue thay vì đánh dấu failed */
const isNetworkError = (err) => !!err && (err.code === ERROR_CODE.SERVER_OFFLINE || err.code === ERROR_CODE.TIMEOUT);
const isTempId = (id) => String(id).startsWith(TEMP_CONVERSATION_PREFIX);

/** IPC GROUP_ACTION → sự kiện WS + cách dựng payload */
const GROUP_ACTION_MAP = Object.freeze({
  [GROUP_ACTION.ADD_MEMBER]: { type: CONV.ADD_MEMBER, build: (d) => ({ user_ids: (d.user_ids || []).map(Number) }) },
  [GROUP_ACTION.APPROVE_MEMBER]: { type: CONV.APPROVE_MEMBER, build: (d) => ({ user_id: Number(d.user_id) }) },
  [GROUP_ACTION.REJECT_MEMBER]: { type: CONV.REJECT_MEMBER, build: (d) => ({ user_id: Number(d.user_id) }) },
  [GROUP_ACTION.REMOVE_MEMBER]: { type: CONV.REMOVE_MEMBER, build: (d) => ({ user_id: Number(d.user_id) }) },
  [GROUP_ACTION.SET_ADMIN]: { type: CONV.SET_ADMIN, build: (d) => ({ user_id: Number(d.user_id), is_admin: !!d.is_admin }) },
  [GROUP_ACTION.DELETE]: { type: CONV.DELETE, build: () => ({}) },
  [GROUP_ACTION.REQUEST_PENDING]: { type: CONV.REQUEST_PENDING, build: () => ({}) },
});

class ChatService {
  /**
   * @param {{ session: object, repos: object, view: object, p2p: object, files: object, clock: object,
   *   logger: object, paths: { CACHE_IMAGES: string } }} deps
   */
  constructor(deps) {
    Object.assign(this, {
      session: deps.session,
      repos: deps.repos,
      view: deps.view,
      p2p: deps.p2p,
      files: deps.files,
      clock: deps.clock,
      log: deps.logger,
      paths: deps.paths,
    });
  }

  // ---------- helpers ----------

  _me() {
    const user = this.session.getUser();
    if (!this.session.isLoggedIn() || !user) throw new AppError(ERROR_CODE.UNAUTHORIZED, 'Bạn chưa đăng nhập.');
    return user;
  }

  _conv(conversationId) {
    const conv = this.repos.conversations.get(String(conversationId || ''));
    if (!conv) throw new AppError(ERROR_CODE.NOT_FOUND, 'Không tìm thấy cuộc trò chuyện.');
    const me = this._me();
    if (!memberIds(conv).includes(Number(me.id))) throw new AppError(ERROR_CODE.FORBIDDEN, 'Bạn không còn là thành viên cuộc trò chuyện này.');
    return conv;
  }

  _ownMessage(conversationId, cmid) {
    const me = this._me();
    const msg = this.repos.messages.get(String(cmid || ''));
    if (!msg || msg.conversation_id !== String(conversationId)) throw new AppError(ERROR_CODE.NOT_FOUND, 'Không tìm thấy tin nhắn.');
    if (Number(msg.sender_id) !== Number(me.id)) throw new AppError(ERROR_CODE.FORBIDDEN, 'Bạn chỉ thao tác được tin nhắn của mình.');
    if (msg.recalled) throw new AppError(ERROR_CODE.CONFLICT, 'Tin nhắn đã được thu hồi.');
    return msg;
  }

  _requireOnline(message) {
    if (!this.session.isOnline()) throw offlineError(message);
  }

  /** Lọc mentions: chỉ id là member của conversation */
  _cleanMentions(conv, mentions) {
    const members = new Set(memberIds(conv));
    return Array.from(new Set((mentions || []).map(Number))).filter((id) => members.has(id));
  }

  /**
   * Tạo tin local (pending) + phát evt ngay.
   * @returns {object} row
   */
  _createLocal(conv, fields) {
    const me = this._me();
    const now = nowIso();
    const { message } = this.repos.messages.insert({
      client_message_id: crypto.randomUUID(),
      conversation_id: String(conv.id),
      sender_id: me.id,
      status: MESSAGE_STATUS.PENDING,
      sync_state: SYNC_STATE.PENDING_PEER,
      vector_clock: this.clock.tick(me.id),
      created_at_local: now,
      ...fields,
    });
    this.repos.conversations.touchLastMessage(conv.id, now);
    this.view.emitMessage(message.client_message_id);
    this.view.emitConversation(conv.id);
    return message;
  }

  /**
   * Gửi tin đã tạo local: server (nếu online) → fallback P2P. Không throw (kết quả qua evt:message).
   * @param {string} cmid
   */
  async dispatch(cmid) {
    const row = this.repos.messages.get(cmid);
    if (!row || row.recalled || row.sync_state === SYNC_STATE.SYNCED) return;
    if (this.session.isOnline() && !isTempId(row.conversation_id)) {
      try {
        await this._sendViaServer(row);
        return;
      } catch (err) {
        if (err.code === ERROR_CODE.CANCELLED) {
          this._markFailed(cmid, 'Đã hủy gửi.');
          return;
        }
        if (!isNetworkError(err)) {
          this.log.warn(LOG_CATEGORY.MESSAGE, 'send_rejected', { client_message_id: cmid, code: err.code });
          this._markFailed(cmid, err.message);
          return;
        }
        this.log.info(LOG_CATEGORY.MESSAGE, 'send_fallback_p2p', { client_message_id: cmid, code: err.code });
      }
    }
    if (this.session.isLoggedIn() && !this.session.isOnline()) {
      try {
        await this.p2p.sendMessage(cmid);
      } catch (err) {
        this.log.warn(LOG_CATEGORY.MESSAGE, 'p2p_dispatch_failed', { client_message_id: cmid, message: err.message });
      }
    }
  }

  _markFailed(cmid, error) {
    this.repos.messages.update(cmid, { status: MESSAGE_STATUS.FAILED, last_error: String(error || '') });
    this.view.emitMessage(cmid);
  }

  async _sendViaServer(row) {
    let fileId = row.file ? row.file.id : null;
    if (row.file && !fileId) {
      // File chưa có trên server → upload từ đường dẫn gốc (hoặc bản cache ảnh paste / P2P)
      const source = row.local_path && fileExists(row.local_path) ? row.local_path : this.files.findLocalCopy(row.file.sha256);
      if (!source) throw new AppError(ERROR_CODE.NOT_FOUND, 'File gốc không còn trên máy — không gửi được.');
      const size = fs.statSync(source).size;
      const wireFile = await this.files.uploadForMessage(row.client_message_id, {
        filePath: source,
        size,
        name: row.file.name,
        mimeType: row.file.mime_type,
      });
      fileId = wireFile.id;
      this.repos.messages.update(row.client_message_id, { file: wireFile, file_sha256: wireFile.sha256 });
    }
    const res = await this.session.request(MESSAGE.SEND, {
      client_message_id: row.client_message_id,
      conversation_id: row.conversation_id,
      type: row.type,
      content: row.content,
      reply_to: row.reply_to,
      file_id: fileId || null,
      mentions: row.mentions || [],
      vector_clock: row.vector_clock || {},
      created_at_local: row.created_at_local,
    });
    if (res && res.message) {
      this.repos.messages.upsertFromServer(res.message);
      this.repos.conversations.touchLastMessage(row.conversation_id, res.message.created_at);
    }
    this.view.emitMessage(row.client_message_id);
    this.view.emitConversation(row.conversation_id);
  }

  // ---------- gửi ----------

  /**
   * @param {{conversation_id, content, reply_to?, mentions?}} input
   * @returns {object} LocalMessage
   */
  sendText(input) {
    const conv = this._conv(input && input.conversation_id);
    const content = validators.normalizeMessageContent(input.content);
    if (!content.ok) throw validationError(content.error);
    const row = this._createLocal(conv, {
      type: MESSAGE_TYPE.TEXT,
      content: content.value,
      reply_to: input.reply_to || null,
      mentions: this._cleanMentions(conv, input.mentions),
    });
    this.dispatch(row.client_message_id).catch((err) => this.log.error(LOG_CATEGORY.MESSAGE, 'dispatch_crashed', { message: err.message }));
    return this.view.message(row.client_message_id);
  }

  /**
   * Gửi ảnh/file. Nguồn: path (giữ nguyên đường dẫn gốc, KHÔNG copy) hoặc data (ảnh paste → cache/images/<sha>.<ext>).
   * @param {{conversation_id, path?, data?, name?, mime_type?, content?, reply_to?, as_image?}} input
   */
  async sendFile(input) {
    const conv = this._conv(input && input.conversation_id);
    const content = validators.normalizeMessageContent(input.content, { allowEmpty: true });
    if (!content.ok) throw validationError(content.error);

    let localPath;
    let size;
    let sha256;
    let name;
    let mimeType;
    if (input.path) {
      let stat;
      try {
        stat = fs.statSync(String(input.path));
      } catch (_err) {
        throw new AppError(ERROR_CODE.NOT_FOUND, 'Không tìm thấy file đã chọn.');
      }
      if (!stat.isFile()) throw validationError('Chỉ gửi được file (không gửi thư mục).');
      size = stat.size;
      if (size > MAX_FILE_SIZE) throw new AppError(ERROR_CODE.TOO_LARGE, 'File vượt quá giới hạn 200MB.');
      localPath = String(input.path);
      name = input.name || path.basename(localPath);
      mimeType = input.mime_type || mimeFromName(name);
      sha256 = await sha256File(localPath);
    } else if (input.data) {
      const buf = Buffer.from(input.data);
      size = buf.length;
      if (!size) throw validationError('Dữ liệu ảnh trống.');
      if (size > MAX_FILE_SIZE) throw new AppError(ERROR_CODE.TOO_LARGE, 'File vượt quá giới hạn 200MB.');
      mimeType = input.mime_type || mimeFromName(input.name || '');
      sha256 = sha256Buffer(buf);
      const ext = EXT_BY_MIME[mimeType] || path.extname(input.name || '') || '.bin';
      name = input.name || `anh-dan-${Date.now()}${ext}`;
      // Ảnh paste không có đường dẫn gốc → lưu cache theo hash (dedup tự nhiên)
      localPath = path.join(this.paths.CACHE_IMAGES, `${sha256}${ext}`);
      if (!fileExists(localPath)) await fs.promises.writeFile(localPath, buf);
    } else {
      throw validationError('Thiếu file cần gửi.');
    }

    const isImage = !!input.as_image || String(mimeType).startsWith(IMAGE_MIME_PREFIX);
    const row = this._createLocal(conv, {
      type: isImage ? MESSAGE_TYPE.IMAGE : MESSAGE_TYPE.FILE,
      content: content.value,
      reply_to: input.reply_to || null,
      file: { id: null, sha256, name: validators.sanitizeFileName(name), size, mime_type: mimeType, has_thumb: false, width: null, height: null },
      file_sha256: sha256,
      local_path: localPath,
    });
    this.log.info(LOG_CATEGORY.FILE, 'send_file', { client_message_id: row.client_message_id, size, mime_type: mimeType });
    this.dispatch(row.client_message_id).catch((err) => this.log.error(LOG_CATEGORY.MESSAGE, 'dispatch_crashed', { message: err.message }));
    return this.view.message(row.client_message_id);
  }

  cancelUpload(cmid) {
    this._me();
    return { cancelled: this.files.cancelUpload(String(cmid || '')) };
  }

  /** Gửi lại tin lỗi/chưa gửi được */
  retry(cmid) {
    const me = this._me();
    const row = this.repos.messages.get(String(cmid || ''));
    if (!row || Number(row.sender_id) !== Number(me.id)) throw new AppError(ERROR_CODE.NOT_FOUND, 'Không tìm thấy tin nhắn.');
    if (row.sync_state === SYNC_STATE.SYNCED) return this.view.message(row.client_message_id);
    this.repos.messages.update(row.client_message_id, { status: MESSAGE_STATUS.PENDING, last_error: null });
    this.view.emitMessage(row.client_message_id);
    this.dispatch(row.client_message_id).catch((err) => this.log.error(LOG_CATEGORY.MESSAGE, 'dispatch_crashed', { message: err.message }));
    return this.view.message(row.client_message_id);
  }

  // ---------- sửa / thu hồi / ghim ----------

  async edit(conversationId, cmid, rawContent) {
    const conv = this._conv(conversationId);
    const msg = this._ownMessage(conversationId, cmid);
    if (msg.type !== MESSAGE_TYPE.TEXT) throw validationError('Chỉ sửa được tin nhắn văn bản.');
    const content = validators.normalizeMessageContent(rawContent);
    if (!content.ok) throw validationError(content.error);
    const updatedAt = nowIso();
    this.repos.messages.update(msg.client_message_id, { content: content.value, edited: true, updated_at: updatedAt });
    this.view.emitMessage(msg.client_message_id);
    const payload = { conversation_id: String(conv.id), client_message_id: msg.client_message_id, content: content.value, updated_at: updatedAt };
    await this._propagate(conv, msg, MESSAGE.EDIT, P2P.MESSAGE_EDIT, ACTION_TYPE.MESSAGE_EDIT, payload);
    return this.view.message(msg.client_message_id);
  }

  async recall(conversationId, cmid) {
    const conv = this._conv(conversationId);
    const msg = this._ownMessage(conversationId, cmid);
    this.repos.messages.update(msg.client_message_id, { recalled: true, content: '', updated_at: nowIso() });
    this.view.emitMessage(msg.client_message_id);
    this.view.emitConversation(conv.id);
    const payload = { conversation_id: String(conv.id), client_message_id: msg.client_message_id };
    await this._propagate(conv, msg, MESSAGE.RECALL, P2P.MESSAGE_RECALL, ACTION_TYPE.MESSAGE_RECALL, payload);
    return this.view.message(msg.client_message_id);
  }

  /**
   * Đẩy edit/recall: online + tin đã có trên server → WS; còn lại → P2P tới peer + action_queue chờ sync.
   */
  async _propagate(conv, msg, wsType, p2pType, actionType, payload) {
    if (this.session.isOnline() && msg.server_id) {
      try {
        await this.session.request(wsType, payload);
        return;
      } catch (err) {
        if (!isNetworkError(err)) throw err;
      }
    }
    const me = this._me();
    this.repos.actions.enqueue(actionType, payload, this.clock.tick(me.id));
    if (!this.session.isOnline()) await this.p2p.broadcastToMembers(conv, p2pType, payload);
  }

  async pin(conversationId, cmid) {
    const conv = this._conv(conversationId);
    this._requireOnline('Chỉ ghim được tin khi server online.');
    await this.session.request(MESSAGE.PIN, { conversation_id: String(conv.id), client_message_id: String(cmid) });
    return { ok: true };
  }

  async unpin(conversationId, cmid) {
    const conv = this._conv(conversationId);
    this._requireOnline('Chỉ bỏ ghim được khi server online.');
    await this.session.request(MESSAGE.UNPIN, { conversation_id: String(conv.id), client_message_id: String(cmid) });
    return { ok: true };
  }

  // ---------- đọc / typing ----------

  /** Reset unread + gửi con trỏ đã đọc tới tin mới nhất (nếu online) */
  markRead(conversationId) {
    const conv = this._conv(conversationId);
    const me = this._me();
    this.repos.conversations.setUnread(conv.id, 0);
    const lastServerId = this.repos.messages.maxServerIdInConversation(conv.id);
    if (lastServerId) {
      this.repos.conversations.updateMemberCursor(conv.id, me.id, lastServerId, lastServerId);
      if (this.session.isOnline() && !isTempId(conv.id)) {
        this.session.send(MESSAGE.READ, { conversation_id: String(conv.id), server_id: lastServerId });
      }
    }
    this.view.emitConversation(conv.id);
    return { ok: true };
  }

  typing(conversationId) {
    const conv = this._conv(conversationId);
    if (this.session.isOnline() && !isTempId(conv.id)) {
      this.session.send(TYPING.TYPING, { conversation_id: String(conv.id) });
    } else {
      this.p2p.sendTyping(conv).catch(() => {});
    }
    return { ok: true };
  }

  // ---------- conversation ----------

  /** Mở chat 1-1 (find-or-create). Offline chỉ mở được chat đã có. */
  async openDirect(userId) {
    const me = this._me();
    const otherId = Number(userId);
    if (!Number.isInteger(otherId) || otherId === Number(me.id)) throw validationError('Người dùng không hợp lệ.');
    const local = this.repos.conversations.findDirectWith(me.id, otherId);
    if (local && !this.session.isOnline()) return this.view.conversation(local.id);
    if (!this.session.isOnline()) {
      throw offlineError('Server offline — chỉ mở được các cuộc trò chuyện đã có. Hãy tạo nhóm hoặc chờ server online.');
    }
    const res = await this.session.request(CONV.CREATE, { type: CONVERSATION_TYPE.DIRECT, member_ids: [otherId] });
    if (!res || !res.conversation) throw new AppError(ERROR_CODE.INTERNAL, 'Server không trả về cuộc trò chuyện');
    this.repos.conversations.upsertFromWire(res.conversation);
    return this.view.emitConversation(res.conversation.id);
  }

  /**
   * Tạo nhóm. Online → server; offline → id tạm temp-<uuid>, queue conv_create, conv-sync tới peer.
   */
  async createGroup(rawName, rawMemberIds) {
    const me = this._me();
    const name = validators.normalizeGroupName(rawName);
    if (!name.ok) throw validationError(name.error);
    const others = Array.from(new Set((rawMemberIds || []).map(Number))).filter((id) => Number.isInteger(id) && id !== Number(me.id));
    if (others.length < MIN_GROUP_OTHER_MEMBERS) {
      throw validationError(`Nhóm cần ít nhất ${MIN_GROUP_OTHER_MEMBERS} thành viên khác ngoài bạn.`);
    }
    if (this.session.isOnline()) {
      const res = await this.session.request(CONV.CREATE, { type: CONVERSATION_TYPE.GROUP, name: name.value, member_ids: others });
      if (!res || !res.conversation) throw new AppError(ERROR_CODE.INTERNAL, 'Server không trả về nhóm vừa tạo');
      this.repos.conversations.upsertFromWire(res.conversation);
      this.log.info(LOG_CATEGORY.MESSAGE, 'group_created', { conversation_id: res.conversation.id });
      return this.view.emitConversation(res.conversation.id);
    }
    const tempId = `${TEMP_CONVERSATION_PREFIX}${crypto.randomUUID()}`;
    const now = nowIso();
    const conv = this.repos.conversations.upsertFromWire(
      {
        id: tempId,
        type: CONVERSATION_TYPE.GROUP,
        name: name.value,
        owner_id: me.id,
        version: 1,
        client_temp_id: tempId,
        created_at: now,
        updated_at: now,
        members: [
          { user_id: me.id, role: GROUP_ROLE.OWNER, last_read_message_id: 0, last_delivered_message_id: 0 },
          ...others.map((id) => ({ user_id: id, role: GROUP_ROLE.MEMBER, last_read_message_id: 0, last_delivered_message_id: 0 })),
        ],
        pinned: [],
      },
      { sync_state: SYNC_STATE.PENDING_SERVER, updated_by: me.id },
    );
    this.repos.conversations.touchLastMessage(tempId, now);
    this.repos.actions.enqueue(ACTION_TYPE.CONV_CREATE, { client_temp_id: tempId, name: name.value, member_ids: others }, this.clock.tick(me.id));
    this.log.info(LOG_CATEGORY.MESSAGE, 'group_created_offline', { conversation_id: tempId });
    this.p2p.syncConversation(conv).catch(() => {});
    return this.view.emitConversation(tempId);
  }

  /** Đổi tên nhóm (mọi member). Offline → version++, pending_server, queue conv_rename, conv-sync P2P. */
  async renameGroup(conversationId, rawName) {
    const conv = this._conv(conversationId);
    if (conv.type !== CONVERSATION_TYPE.GROUP) throw validationError('Chỉ đổi tên được nhóm.');
    const name = validators.normalizeGroupName(rawName);
    if (!name.ok) throw validationError(name.error);
    const me = this._me();
    const version = (Number(conv.version) || 1) + 1;
    const updatedAt = nowIso();
    if (this.session.isOnline() && !isTempId(conv.id)) {
      await this.session.request(CONV.RENAME, { conversation_id: String(conv.id), name: name.value, version, updated_at: updatedAt });
      return this.view.conversation(conv.id);
    }
    this.repos.conversations.applyRename(conv.id, {
      name: name.value,
      version,
      updated_at: updatedAt,
      updated_by: me.id,
      sync_state: SYNC_STATE.PENDING_SERVER,
    });
    this.repos.actions.enqueue(
      ACTION_TYPE.CONV_RENAME,
      { conversation_id: String(conv.id), name: name.value, version, updated_at: updatedAt },
      this.clock.tick(me.id),
    );
    this.p2p.syncConversation(this.repos.conversations.get(conv.id)).catch(() => {});
    return this.view.emitConversation(conv.id);
  }

  /** Hành động nhóm chỉ online (thêm/duyệt/từ chối/xóa member, phó nhóm, xóa nhóm, xem pending) */
  async groupAction(action, data) {
    const spec = GROUP_ACTION_MAP[action];
    if (!spec) throw validationError('Hành động nhóm không hợp lệ.');
    const conv = this._conv(data && data.conversation_id);
    if (conv.type !== CONVERSATION_TYPE.GROUP) throw validationError('Chỉ áp dụng cho nhóm.');
    if (isTempId(conv.id)) throw offlineError('Nhóm chưa được đồng bộ lên server — thử lại khi server online.');
    this._requireOnline('Thao tác này chỉ thực hiện được khi server online.');
    const res = await this.session.request(spec.type, { conversation_id: String(conv.id), ...spec.build(data || {}) });
    if (action === GROUP_ACTION.REQUEST_PENDING && res && Array.isArray(res.pending)) {
      return { conversation_id: String(conv.id), pending: res.pending };
    }
    return res || { ok: true };
  }

  /** Kéo thêm lịch sử cũ từ server khi local hết */
  async loadOlderFromServer(conversationId) {
    const conv = this._conv(conversationId);
    if (isTempId(conv.id)) return { count: 0, has_more: false };
    this._requireOnline('Cần server online để tải thêm lịch sử cũ.');
    const before = this.repos.messages.minServerIdInConversation(conv.id);
    const res = await this.session.request(MESSAGE.HISTORY, {
      conversation_id: String(conv.id),
      ...(before ? { before_server_id: before } : {}),
      limit: PAGE_SIZE,
    });
    const list = (res && res.messages) || [];
    let count = 0;
    this.repos.transaction(() => {
      for (const m of list) if (this.repos.messages.upsertFromServer(m).inserted) count += 1;
    });
    return { count, has_more: !!(res && res.has_more) };
  }
}

module.exports = { ChatService, isNetworkError, GROUP_ACTION_MAP };
