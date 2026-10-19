/**
 * Hậu xử lý chung khi có tin MỚI tới (từ server hoặc peer): tăng unread, cập nhật last_message_at,
 * đẩy evt:message + evt:conversation, hiện notification khi cửa sổ không focus.
 */
'use strict';

const { MESSAGE_TYPE, IMAGE_MIME_PREFIX } = require('../../../shared/constants');
const { previewText } = require('../../../shared/serializer');

const NOTIFY_PREVIEW_MAX = 100;

/** Nội dung ngắn cho notification */
function notificationBody(msg) {
  if (msg.recalled) return '';
  if (msg.type === MESSAGE_TYPE.IMAGE || (msg.file && String(msg.file.mime_type || '').startsWith(IMAGE_MIME_PREFIX))) {
    return msg.content ? `[Ảnh] ${previewText(msg.content, NOTIFY_PREVIEW_MAX)}` : '[Ảnh]';
  }
  if (msg.type === MESSAGE_TYPE.FILE) return `[Tệp] ${(msg.file && msg.file.name) || ''}`;
  return previewText(msg.content, NOTIFY_PREVIEW_MAX);
}

/**
 * @param {{ repos: object, view: object, getMyUserId: () => number|null,
 *   ui?: { notify?: Function, isWindowFocused?: () => boolean }, notificationsEnabled?: boolean, logger: object }} deps
 */
function createMessageIngest(deps) {
  const { repos, view, getMyUserId } = deps;

  /**
   * @param {object} row message row (messageRepo)
   * @param {boolean} inserted true nếu là tin mới (không phải bản cập nhật)
   */
  function afterIncoming(row, inserted) {
    const convId = row.conversation_id;
    const at = row.created_at || row.created_at_local;
    repos.conversations.touchLastMessage(convId, at);
    const fromOther = Number(row.sender_id) !== Number(getMyUserId());
    if (inserted && fromOther && row.type !== MESSAGE_TYPE.SYSTEM) {
      repos.conversations.incrementUnread(convId, 1);
      maybeNotify(row);
    }
    view.emitMessage(row.client_message_id);
    view.emitConversation(convId);
  }

  function maybeNotify(row) {
    const ui = deps.ui;
    if (!deps.notificationsEnabled || !ui || !ui.notify) return;
    if (ui.isWindowFocused && ui.isWindowFocused()) return;
    try {
      const sender = repos.users.get(row.sender_id);
      const conv = repos.conversations.get(row.conversation_id);
      const senderName = (sender && sender.display_name) || 'Tin nhắn mới';
      const title = conv && conv.type === 'group' && conv.name ? `${senderName} • ${conv.name}` : senderName;
      ui.notify({ title, body: notificationBody(row), conversation_id: String(row.conversation_id) });
    } catch (err) {
      deps.logger.warn('app', 'notify_failed', { message: err.message });
    }
  }

  return { afterIncoming, notificationBody };
}

module.exports = { createMessageIngest, notificationBody };
