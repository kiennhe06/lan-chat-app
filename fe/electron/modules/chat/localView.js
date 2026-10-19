/**
 * Đọc dữ liệu local + đẩy evt:message / evt:conversation / evt:users xuống renderer theo shape Local*.
 * Gom ở đây để mọi service phát sự kiện nhất quán (DRY).
 */
'use strict';

const { IPC_EVENTS } = require('../../../ipc/channels');
const { toLocalMessage, toLocalConversation, toLocalUser } = require('./mappers');

/**
 * @param {{ repos: object, emit: Function, getMyUserId: () => number|null, ui?: { setUnreadCount?: Function } }} deps
 */
function createLocalView(deps) {
  const { repos, emit, getMyUserId } = deps;
  const uploadPercents = new Map(); // client_message_id → % (đang upload)

  const conversation = (id) => {
    const row = repos.conversations.get(id);
    return row ? toLocalConversation(row, getMyUserId(), repos.messages.latestInConversation(row.id)) : null;
  };

  const message = (cmid) => {
    const row = repos.messages.get(cmid);
    if (!row) return null;
    const pct = uploadPercents.get(cmid);
    return toLocalMessage(row, pct !== undefined ? { upload_percent: pct } : undefined);
  };

  function refreshBadge() {
    if (deps.ui && deps.ui.setUnreadCount) {
      try {
        deps.ui.setUnreadCount(repos.conversations.totalUnread());
      } catch (_err) {
        /* badge chỉ là trang trí — bỏ qua lỗi nền tảng */
      }
    }
  }

  return {
    conversation,
    message,
    listConversations: () => {
      const me = getMyUserId();
      return repos.conversations.list().map((row) => toLocalConversation(row, me, repos.messages.latestInConversation(row.id)));
    },
    listUsers: () => repos.users.list().map(toLocalUser),
    /** Đẩy evt:message (đọc lại từ DB) */
    emitMessage(cmid) {
      const m = message(cmid);
      if (m) emit(IPC_EVENTS.MESSAGE, { message: m });
      return m;
    },
    /** Đẩy evt:conversation + cập nhật badge */
    emitConversation(id) {
      const c = conversation(id);
      if (c) emit(IPC_EVENTS.CONVERSATION, { conversation: c });
      refreshBadge();
      return c;
    },
    emitConversationRemoved(id) {
      emit(IPC_EVENTS.CONVERSATION_REMOVED, { conversation_id: String(id) });
      refreshBadge();
    },
    emitUsers(users) {
      emit(IPC_EVENTS.USERS, { users: (users || []).map(toLocalUser) });
    },
    setUploadPercent(cmid, pct) {
      if (pct === null || pct === undefined) uploadPercents.delete(cmid);
      else uploadPercents.set(cmid, pct);
    },
    refreshBadge,
  };
}

module.exports = { createLocalView };
