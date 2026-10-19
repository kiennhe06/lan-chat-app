/**
 * Đồng bộ (reconciliation) khi client kết nối lại server (PROTOCOL §5).
 *
 * Mọi thay đổi đi qua CHÍNH các hàm của messageService / conversationService → broadcast giống hệt đường online.
 *  - sync:request        → snapshot conversations + users + tin mới (server_id > since, tối đa N, mới nhất).
 *  - sync:message-batch  → upsert theo client_message_id (idempotent), map conversation temp-… qua client_temp_id.
 *  - sync:action-batch   → conv_create / conv_rename (LWW) / message_edit / message_recall; idempotent theo client_action_id.
 *  - sync:file-batch     → phân loại file server đã có / còn thiếu theo sha256.
 */
'use strict';

const C = require('../../shared/constants');
const { errors, toWireError, isAppError } = require('../../core/errors');
const { NUMERIC_ID_RE } = require('../chat/conversationAccess');

const ACTION = C.ACTION_TYPE;
const CAT = C.LOG_CATEGORY.MESSAGE;
const CLIENT_ACTION_ID_RE = /^[A-Za-z0-9_.:-]{1,100}$/;

/**
 * @param {{ repos: object, hub: object, logger: object, config: object, messageService: object,
 *   conversationService: object, fileService: object, authService: object }} deps
 */
function createSyncService(deps) {
  const { repos, logger, config, messageService, conversationService, fileService, authService } = deps;
  const limits = config.sync;

  /** Ghi log lỗi không phải lỗi nghiệp vụ (lỗi nghiệp vụ là kết quả bình thường của batch). */
  const logUnexpected = (action, err, userId, meta) => {
    if (!isAppError(err)) logger.error(C.LOG_CATEGORY.ERROR, action, { ...meta, error: err }, { userId });
  };

  const requireArray = (value, max, label) => {
    if (!Array.isArray(value)) throw errors.validation(`${label} phải là mảng`);
    if (value.length > max) throw errors.validation(`${label} tối đa ${max} phần tử mỗi lần`);
    return value;
  };

  /**
   * sync:request — snapshot cho user.
   * deleted_conversation_ids = các id client đang biết nhưng user không còn là member (bị xóa / nhóm bị xóa).
   */
  function request(userId, input) {
    const src = input || {};
    const conversations = conversationService.listForUser(userId);
    const { messages, has_more } = messageService.listSince(userId, src.since_server_id, limits.maxMessagesPerResponse);
    const currentIds = new Set(conversations.map((c) => c.id));
    const known = Array.isArray(src.known_conversation_ids) ? src.known_conversation_ids.map(String) : [];
    const deleted = known.filter((id) => NUMERIC_ID_RE.test(id) && !currentIds.has(id));
    return {
      conversations,
      users: authService.listUsers(),
      messages,
      deleted_conversation_ids: Array.from(new Set(deleted)),
      server_time: new Date().toISOString(),
      has_more,
    };
  }

  /** Xử lý 1 tin trong message-batch → kết quả theo PROTOCOL. */
  function syncOneMessage(pusherId, item, ip) {
    const cmid = item && item.client_message_id;
    try {
      const senderId = item.sender_id == null ? pusherId : Number(item.sender_id);
      if (!Number.isSafeInteger(senderId) || senderId <= 0) throw errors.validation('sender_id không hợp lệ');
      const { message } = messageService.send(senderId, item, { pusherId, ip });
      return { client_message_id: cmid, ok: true, server_id: message.server_id, created_at: message.created_at, status: 'ok' };
    } catch (err) {
      logUnexpected('sync_message_failed', err, pusherId, { client_message_id: cmid });
      const status = err && err.code === C.ERROR_CODE.CONFLICT ? 'conflict' : 'error';
      return { client_message_id: cmid, ok: false, status, error: toWireError(err) };
    }
  }

  /**
   * sync:message-batch (≤ 100 tin). Tin do peer chuyển hộ hợp lệ khi cả người gửi và người đẩy đều là member.
   */
  function messageBatch(userId, input, ip) {
    const items = requireArray(input && input.messages, limits.maxMessageBatch, 'messages');
    const results = items.map((item) => syncOneMessage(userId, item || {}, ip));
    const okCount = results.filter((r) => r.ok).length;
    logger.info(CAT, 'sync_message_batch', { total: items.length, ok: okCount }, { userId, ip });
    return { results };
  }

  /** Thực thi 1 action theo loại. @returns {{ result: object, conflict?: boolean }} */
  function runAction(userId, action) {
    const payload = action.payload || {};
    switch (action.action_type) {
      case ACTION.CONV_CREATE: {
        const { conversation } = conversationService.createGroup(userId, payload, { createdAt: action.created_at });
        return { result: { conversation } };
      }
      case ACTION.CONV_RENAME: {
        const r = conversationService.rename(userId, payload, { fromSync: true });
        return { result: { conversation: r.conversation }, conflict: r.conflict };
      }
      case ACTION.MESSAGE_EDIT: {
        const r = messageService.edit(userId, payload, { fromSync: true });
        return { result: { message: r.message }, conflict: r.conflict };
      }
      case ACTION.MESSAGE_RECALL: {
        messageService.recall(userId, payload);
        return { result: { ok: true } };
      }
      default:
        throw errors.validation('action_type không hợp lệ');
    }
  }

  /** Xử lý 1 action có kiểm tra idempotent theo client_action_id. */
  function syncOneAction(userId, action) {
    const id = action && action.client_action_id;
    if (typeof id !== 'string' || !CLIENT_ACTION_ID_RE.test(id)) {
      return { client_action_id: id, ok: false, error: toWireError(errors.validation('client_action_id không hợp lệ')) };
    }
    const done = repos.actionQueue.find(userId, id);
    if (done && done.ok) {
      // Đã xử lý trước đó (client gửi lại vì mất ack) → trả lại kết quả cũ
      const stored = JSON.parse(done.result || '{}');
      return { client_action_id: id, ok: true, result: stored.result, ...(stored.conflict ? { conflict: true } : {}) };
    }
    try {
      const { result, conflict } = runAction(userId, action);
      repos.actionQueue.insert({
        client_action_id: id,
        user_id: userId,
        action_type: action.action_type,
        ok: 1,
        result: JSON.stringify({ result, conflict: !!conflict }),
        created_at: new Date().toISOString(),
      });
      return { client_action_id: id, ok: true, result, ...(conflict ? { conflict: true } : {}) };
    } catch (err) {
      logUnexpected('sync_action_failed', err, userId, { client_action_id: id, action_type: action.action_type });
      return { client_action_id: id, ok: false, error: toWireError(err) };
    }
  }

  /**
   * sync:action-batch. conv_create được xử lý trước (để các action sau map được id tạm).
   */
  function actionBatch(userId, input, ip) {
    const actions = requireArray(input && input.actions, limits.maxActionBatch, 'actions');
    const order = (a) => (a && a.action_type === ACTION.CONV_CREATE ? 0 : 1);
    const indexed = actions.map((action, index) => ({ action: action || {}, index }));
    indexed.sort((a, b) => order(a.action) - order(b.action) || a.index - b.index);
    const results = new Array(actions.length);
    for (const { action, index } of indexed) results[index] = syncOneAction(userId, action);
    const conflicts = results.filter((r) => r.conflict).length;
    logger.info(CAT, 'sync_action_batch', { total: actions.length, conflicts }, { userId, ip });
    return { results };
  }

  /** sync:file-batch. */
  async function fileBatch(userId, input) {
    const files = requireArray(input && input.files, limits.maxFileBatch, 'files');
    return fileService.checkBatch(userId, files);
  }

  /** sync:ack — chỉ ghi log mốc đồng bộ của client. */
  function ack(userId, input, ip) {
    const last = Number(input && input.last_server_id) || 0;
    logger.debug(CAT, 'sync_ack', { last_server_id: last }, { userId, ip });
    return { ok: true };
  }

  return { request, messageBatch, actionBatch, fileBatch, ack };
}

module.exports = { createSyncService };
