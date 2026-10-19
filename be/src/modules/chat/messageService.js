/**
 * Nghiệp vụ tin nhắn: gửi (idempotent theo client_message_id), sửa, thu hồi, ghim, con trỏ đã nhận/đã đọc,
 * lịch sử, tin system. Dùng chung cho đường online (ws) và đồng bộ offline (syncService) → broadcast giống nhau.
 */
'use strict';

const crypto = require('crypto');
const C = require('../../shared/constants');
const V = require('../../shared/validators');
const W = require('../../shared/wsEvents');
const { errors } = require('../../core/errors');
const { messageRowToWire, pinRowToWire } = require('./wireMappers');
const { isManagerRole } = require('./conversationAccess');

const CLIENT_ID_RE = /^[A-Za-z0-9-]{8,64}$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const MAX_MENTIONS = 100;
const USER_SENDABLE_TYPES = [C.MESSAGE_TYPE.TEXT, C.MESSAGE_TYPE.IMAGE, C.MESSAGE_TYPE.FILE];

const isUniqueViolation = (err) => err && err.code === 'SQLITE_CONSTRAINT_UNIQUE';
const validIso = (v) => (typeof v === 'string' && ISO_DATE_RE.test(v) && !Number.isNaN(Date.parse(v)) ? v : null);

/** Chỉ giữ các cặp {user_id: counter} hợp lệ. */
function sanitizeVectorClock(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw)) {
    const n = Number(value);
    if (/^\d{1,15}$/.test(key) && Number.isSafeInteger(n) && n >= 0) out[key] = n;
  }
  return out;
}

function requireClientMessageId(raw) {
  if (typeof raw !== 'string' || !CLIENT_ID_RE.test(raw)) throw errors.validation('client_message_id không hợp lệ');
  return raw;
}

/**
 * @param {{ repos: object, access: object, hub: object, logger: object }} deps
 */
function createMessageService(deps) {
  const { repos, access, hub, logger } = deps;
  const CAT = C.LOG_CATEGORY.MESSAGE;
  const nowIso = () => new Date().toISOString();

  const broadcastToConv = (convId, type, data) => hub.toUsers(access.memberIds(convId), type, data);
  const getWire = (cmid) => messageRowToWire(repos.messages.findByClientId(cmid));

  /** Tìm file đính kèm theo file_id hoặc sha256. */
  function resolveFile(input) {
    if (input.file_id != null) {
      const file = repos.files.findById(Number(input.file_id));
      if (!file) throw errors.notFound('File đính kèm không tồn tại trên server');
      return file;
    }
    if (typeof input.file_sha256 === 'string' && /^[a-f0-9]{64}$/.test(input.file_sha256)) {
      const file = repos.files.findBySha(input.file_sha256);
      if (!file) throw errors.notFound('File đính kèm chưa được tải lên server');
      return file;
    }
    throw errors.validation('Tin ảnh/file phải kèm file');
  }

  /** Lọc mentions: số nguyên, là member, không trùng. */
  function sanitizeMentions(raw, convId) {
    if (!Array.isArray(raw) || !raw.length) return [];
    const members = new Set(access.memberIds(convId));
    const ids = raw.map(Number).filter((id) => Number.isInteger(id) && members.has(id));
    return Array.from(new Set(ids)).slice(0, MAX_MENTIONS);
  }

  /** Chuẩn hóa toàn bộ input gửi tin (validate lại phía server). */
  function normalizeSendInput(conv, input) {
    const type = input.type || C.MESSAGE_TYPE.TEXT;
    if (!USER_SENDABLE_TYPES.includes(type)) throw errors.validation('Loại tin nhắn không hợp lệ');
    const contentResult = V.normalizeMessageContent(input.content, { allowEmpty: type !== C.MESSAGE_TYPE.TEXT });
    if (!contentResult.ok) throw errors.validation(contentResult.error);
    const file = type === C.MESSAGE_TYPE.TEXT ? null : resolveFile(input);
    const replyTo = input.reply_to == null || input.reply_to === '' ? null : requireClientMessageId(input.reply_to);
    return {
      type,
      content: contentResult.value,
      file_id: file ? file.id : null,
      reply_to: replyTo,
      mentions: sanitizeMentions(input.mentions, conv.id),
      vector_clock: sanitizeVectorClock(input.vector_clock),
      created_at_local: validIso(input.created_at_local),
    };
  }

  /** Bản đã lưu trùng client_message_id: hợp lệ nếu cùng người gửi + cùng conversation. */
  function existingOrConflict(existing, senderId, convId) {
    if (existing.sender_id !== senderId || existing.conversation_id !== convId) {
      throw errors.conflict('client_message_id đã được dùng cho tin khác');
    }
    return { message: messageRowToWire(existing), created: false };
  }

  /**
   * Gửi tin (idempotent). Dùng cho message:send và sync:message-batch.
   * @param {number} senderId người gửi thực sự
   * @param {object} input payload message:send
   * @param {{ pusherId?: number, ip?: string }} [opts] pusherId ≠ senderId khi peer chuyển hộ (sync)
   * @returns {{ message: object, created: boolean }}
   */
  function send(senderId, input, opts) {
    const options = opts || {};
    const src = input || {};
    const cmid = requireClientMessageId(src.client_message_id);
    const { conv } = access.requireMember(src.conversation_id, senderId);
    if (options.pusherId && options.pusherId !== senderId) access.requireMember(src.conversation_id, options.pusherId);

    const existing = repos.messages.findByClientId(cmid);
    if (existing) return existingOrConflict(existing, senderId, conv.id);

    const data = normalizeSendInput(conv, src);
    const now = nowIso();
    try {
      repos.conversations.transaction(() => {
        repos.messages.insert({
          client_message_id: cmid,
          conversation_id: conv.id,
          sender_id: senderId,
          type: data.type,
          content: data.content,
          reply_to: data.reply_to,
          file_id: data.file_id,
          mentions: JSON.stringify(data.mentions),
          vector_clock: JSON.stringify(data.vector_clock),
          created_at: now,
          created_at_local: data.created_at_local,
        });
        for (const [uid, counter] of Object.entries(data.vector_clock)) repos.vectorClocks.upsertMax(Number(uid), counter);
        repos.conversations.setUpdatedAt(conv.id, now);
      });
    } catch (err) {
      // 2 request đồng thời cùng client_message_id → trả bản đã lưu
      if (isUniqueViolation(err)) return existingOrConflict(repos.messages.findByClientId(cmid), senderId, conv.id);
      throw err;
    }
    const message = getWire(cmid);
    logger.info(
      CAT,
      'message_sent',
      { conversation_id: message.conversation_id, server_id: message.server_id, type: data.type, file_id: data.file_id || undefined, relayed_by: options.pusherId || undefined, ...logger.contentMeta(data.content) },
      { userId: senderId, ip: options.ip }
    );
    broadcastToConv(conv.id, W.MESSAGE.NEW, { message });
    return { message, created: true };
  }

  /**
   * Chèn tin system (không broadcast — caller gọi broadcastNew sau khi commit transaction).
   * @returns {object} WireMessage
   */
  function insertSystem(convId, actorId, text) {
    const cmid = crypto.randomUUID();
    const now = nowIso();
    repos.messages.insert({
      client_message_id: cmid,
      conversation_id: convId,
      sender_id: actorId,
      type: C.MESSAGE_TYPE.SYSTEM,
      content: text,
      reply_to: null,
      file_id: null,
      mentions: '[]',
      vector_clock: '{}',
      created_at: now,
      created_at_local: null,
    });
    repos.conversations.setUpdatedAt(convId, now);
    return getWire(cmid);
  }

  /** Broadcast message:new cho các tin system đã chèn. */
  function broadcastNew(messages) {
    for (const message of messages) broadcastToConv(Number(message.conversation_id), W.MESSAGE.NEW, { message });
  }

  /** Tin thuộc conversation + người thao tác là người gửi. */
  function requireOwnMessage(userId, input) {
    const src = input || {};
    const cmid = requireClientMessageId(src.client_message_id);
    const { conv } = access.requireMember(src.conversation_id, userId);
    const row = repos.messages.findByClientId(cmid);
    if (!row || row.conversation_id !== conv.id) throw errors.notFound('Tin nhắn không tồn tại');
    if (row.sender_id !== userId) throw errors.forbidden('Bạn chỉ có thể thao tác trên tin nhắn của mình');
    return { conv, row, cmid };
  }

  /**
   * Sửa tin text của chính mình.
   * @param {{ fromSync?: boolean, ip?: string }} [opts] fromSync: áp dụng LWW theo updated_at
   * @returns {{ message: object, changed: boolean, conflict: boolean }}
   */
  function edit(userId, input, opts) {
    const options = opts || {};
    const { row, cmid } = requireOwnMessage(userId, input);
    const keepServer = () => ({ message: messageRowToWire(row), changed: false, conflict: true });
    if (row.recalled) {
      if (options.fromSync) return keepServer();
      throw errors.validation(C.MESSAGES_VI.RECALLED);
    }
    if (row.type !== C.MESSAGE_TYPE.TEXT) throw errors.validation('Chỉ sửa được tin nhắn văn bản');
    const incomingAt = validIso(input.updated_at);
    if (options.fromSync && row.updated_at && incomingAt && incomingAt < row.updated_at) return keepServer();
    const content = V.normalizeMessageContent(input.content);
    if (!content.ok) throw errors.validation(content.error);
    if (content.value === row.content) return { message: messageRowToWire(row), changed: false, conflict: false };
    repos.messages.updateContent(cmid, content.value, nowIso());
    const message = getWire(cmid);
    const previous = logger.contentMeta(row.content);
    logger.info(
      CAT,
      'message_edited',
      { client_message_id: cmid, conversation_id: String(row.conversation_id), ...logger.contentMeta(content.value), ...(previous.content ? { previous_content: previous.content } : {}) },
      { userId, ip: options.ip }
    );
    broadcastToConv(row.conversation_id, W.MESSAGE.EDITED, { message });
    return { message, changed: true, conflict: false };
  }

  /**
   * Thu hồi tin của chính mình (idempotent). Tự bỏ ghim nếu đang ghim.
   * @returns {{ ok: true, changed: boolean }}
   */
  function recall(userId, input, opts) {
    const options = opts || {};
    const { row, cmid } = requireOwnMessage(userId, input);
    if (row.recalled) return { ok: true, changed: false };
    let unpinned = false;
    repos.conversations.transaction(() => {
      repos.messages.recall(cmid, nowIso());
      unpinned = repos.conversations.removePin(row.conversation_id, cmid) > 0;
    });
    const conversationId = String(row.conversation_id);
    // DB đã xóa nội dung khi thu hồi → nhật ký là nơi duy nhất còn giữ nội dung gốc
    logger.info(CAT, 'message_recalled', { client_message_id: cmid, conversation_id: conversationId, type: row.type, ...logger.contentMeta(row.content) }, { userId, ip: options.ip });
    broadcastToConv(row.conversation_id, W.MESSAGE.RECALLED, { conversation_id: conversationId, client_message_id: cmid });
    if (unpinned) broadcastPins(row.conversation_id, W.CONV.UNPINNED);
    return { ok: true, changed: true };
  }

  /** Danh sách ghim dạng WirePin. */
  const listPins = (convId) => repos.conversations.listPins(convId).map(pinRowToWire);

  function broadcastPins(convId, type) {
    broadcastToConv(convId, type, { conversation_id: String(convId), pinned: listPins(convId) });
  }

  /** Quyền ghim: nhóm → owner/admin; 1-1 → cả 2. */
  function requirePinTarget(userId, input) {
    const src = input || {};
    const cmid = requireClientMessageId(src.client_message_id);
    const { conv, member } = access.requireMember(src.conversation_id, userId);
    if (conv.type === C.CONVERSATION_TYPE.GROUP && !isManagerRole(member.role)) {
      throw errors.forbidden('Chỉ trưởng nhóm hoặc phó nhóm được ghim tin nhắn');
    }
    const row = repos.messages.findByClientId(cmid);
    if (!row || row.conversation_id !== conv.id) throw errors.notFound('Tin nhắn không tồn tại');
    return { conv, row, cmid };
  }

  function pin(userId, input) {
    const { conv, row, cmid } = requirePinTarget(userId, input);
    if (row.recalled) throw errors.validation('Không thể ghim tin đã thu hồi');
    if (row.type === C.MESSAGE_TYPE.SYSTEM) throw errors.validation('Không thể ghim tin hệ thống');
    if (repos.conversations.addPin(conv.id, cmid, userId, nowIso())) {
      logger.info(CAT, 'message_pinned', { conversation_id: String(conv.id), client_message_id: cmid }, { userId });
      broadcastPins(conv.id, W.CONV.PINNED);
    }
    return { ok: true, pinned: listPins(conv.id) };
  }

  function unpin(userId, input) {
    const { conv, cmid } = requirePinTarget(userId, input);
    if (repos.conversations.removePin(conv.id, cmid)) {
      logger.info(CAT, 'message_unpinned', { conversation_id: String(conv.id), client_message_id: cmid }, { userId });
      broadcastPins(conv.id, W.CONV.UNPINNED);
    }
    return { ok: true, pinned: listPins(conv.id) };
  }

  /**
   * Cập nhật con trỏ đã nhận / đã đọc (chỉ tiến, MAX). Broadcast message:status_update khi thay đổi.
   * @param {'delivered'|'read'} kind
   */
  function markCursor(userId, input, kind) {
    const src = input || {};
    const { conv, member } = access.requireMember(src.conversation_id, userId);
    const serverId = Number(src.server_id);
    if (!Number.isSafeInteger(serverId) || serverId <= 0) throw errors.validation('server_id không hợp lệ');
    // Không cho con trỏ vượt quá tin mới nhất của conversation
    const target = Math.min(serverId, repos.messages.maxIdInConversation(conv.id));
    const isRead = kind === C.MESSAGE_STATUS.READ;
    repos.conversations.advanceCursors({
      conversation_id: conv.id,
      user_id: userId,
      delivered: target,
      read: isRead ? target : 0,
    });
    const after = repos.conversations.getMember(conv.id, userId);
    const changed =
      after.last_read_message_id !== member.last_read_message_id ||
      after.last_delivered_message_id !== member.last_delivered_message_id;
    if (changed) {
      broadcastToConv(conv.id, W.MESSAGE.STATUS_UPDATE, {
        conversation_id: String(conv.id),
        user_id: userId,
        last_delivered_message_id: after.last_delivered_message_id,
        last_read_message_id: after.last_read_message_id,
      });
    }
    return { ok: true };
  }

  /**
   * Lịch sử 1 conversation (tăng dần), phân trang theo before_server_id.
   */
  function history(userId, input) {
    const src = input || {};
    const { conv } = access.requireMember(src.conversation_id, userId);
    const limit = Math.min(Math.max(Number(src.limit) || C.PAGE_SIZE, 1), C.PAGE_SIZE);
    const before = Number(src.before_server_id) > 0 ? Number(src.before_server_id) : null;
    const rows = repos.messages.listPage(conv.id, before, limit + 1);
    const hasMore = rows.length > limit;
    const messages = rows.slice(0, limit).reverse().map(messageRowToWire);
    return { conversation_id: String(conv.id), messages, has_more: hasMore };
  }

  /**
   * Tin mới hơn sinceId trong mọi conversation của user — lấy MỚI NHẤT tối đa limit, trả tăng dần.
   */
  function listSince(userId, sinceId, limit) {
    const rows = repos.messages.listSinceForUser(userId, Math.max(Number(sinceId) || 0, 0), limit + 1);
    const hasMore = rows.length > limit;
    return { messages: rows.slice(0, limit).reverse().map(messageRowToWire), has_more: hasMore };
  }

  /** Tin cuối của conversation (cho WireConversation.last_message). */
  function lastMessage(convId) {
    const rows = repos.messages.listPage(convId, null, 1);
    return rows.length ? messageRowToWire(rows[0]) : null;
  }

  return {
    send,
    edit,
    recall,
    pin,
    unpin,
    markCursor,
    history,
    listSince,
    lastMessage,
    listPins,
    insertSystem,
    broadcastNew,
  };
}

module.exports = { createMessageService, sanitizeVectorClock };
