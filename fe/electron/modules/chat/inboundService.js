/**
 * Xử lý push event từ server: LƯU client.db TRƯỚC, rồi mới đẩy xuống renderer (Local*).
 * Tự gửi message:delivered khi nhận tin mới của người khác.
 */
'use strict';

const { MESSAGE_TYPE, LOG_CATEGORY } = require('../../../shared/constants');
const { MESSAGE, CONV, USER, PRESENCE, TYPING, CALL } = require('../../../shared/wsEvents');
const { IPC_EVENTS } = require('../../../ipc/channels');
const { toLocalUser } = require('./mappers');

const CALL_TYPES = new Set(Object.values(CALL));

/**
 * Áp dụng 1 WireConversation từ server (map id tạm → id thật nếu có client_temp_id).
 * Dùng chung cho push conv:created/updated và sync pull.
 * @returns {{ conversation: object, remappedFrom: string|null }}
 */
function applyServerConversation(repos, wire) {
  let remappedFrom = null;
  const tempId = wire.client_temp_id;
  if (tempId && String(tempId) !== String(wire.id) && repos.conversations.get(tempId)) {
    remapConversationId(repos, tempId, String(wire.id));
    remappedFrom = String(tempId);
  }
  const conversation = repos.conversations.upsertFromWire(wire);
  return { conversation, remappedFrom };
}

/**
 * Đổi id tạm → id thật trên mọi bảng (messages, conversations_cache, action_queue) trong 1 transaction.
 * @returns {{ messages: number, actions: number }}
 */
function remapConversationId(repos, oldId, newId) {
  return repos.transaction(() => {
    repos.conversations.remapId(oldId, newId);
    const messages = repos.messages.remapConversation(oldId, newId);
    const actions = repos.actions.remapConversationId(oldId, newId);
    return { messages, actions };
  });
}

/**
 * @param {{ repos: object, view: object, ingest: object, session: object, emit: Function, logger: object }} deps
 */
function createInboundHandler(deps) {
  const { repos, view, ingest, session, emit, log } = { ...deps, log: deps.logger };

  const myId = () => session.getUserId();

  function sendDelivered(conversationId, serverId) {
    if (!serverId) return;
    session.send(MESSAGE.DELIVERED, { conversation_id: String(conversationId), server_id: serverId });
  }

  function onMessageNew(data) {
    const wire = data && data.message;
    if (!wire || !wire.client_message_id) return;
    const { inserted, message } = repos.messages.upsertFromServer(wire);
    if (Number(wire.sender_id) !== Number(myId()) && wire.type !== MESSAGE_TYPE.SYSTEM) {
      sendDelivered(wire.conversation_id, wire.server_id);
    }
    if (!repos.conversations.get(wire.conversation_id)) {
      log.warn(LOG_CATEGORY.MESSAGE, 'message_for_unknown_conversation', { conversation_id: wire.conversation_id });
    }
    ingest.afterIncoming(message, inserted);
  }

  function onMessageEdited(data) {
    const wire = data && data.message;
    if (!wire) return;
    repos.messages.upsertFromServer(wire);
    view.emitMessage(wire.client_message_id);
  }

  function onMessageRecalled(data) {
    const cmid = data && data.client_message_id;
    if (!cmid || !repos.messages.get(cmid)) return;
    repos.messages.update(cmid, { recalled: true, content: '' });
    view.emitMessage(cmid);
    view.emitConversation(data.conversation_id);
  }

  function onStatusUpdate(data) {
    if (!data || !data.conversation_id) return;
    repos.conversations.updateMemberCursor(data.conversation_id, data.user_id, data.last_delivered_message_id, data.last_read_message_id);
    if (Number(data.user_id) !== Number(myId())) {
      repos.messages.advanceOwnStatuses(data.conversation_id, myId(), data.last_delivered_message_id || 0, data.last_read_message_id || 0);
    }
    emit(IPC_EVENTS.STATUS, {
      conversation_id: String(data.conversation_id),
      user_id: data.user_id,
      last_delivered_message_id: data.last_delivered_message_id || 0,
      last_read_message_id: data.last_read_message_id || 0,
    });
  }

  function onConversation(data) {
    const wire = data && data.conversation;
    if (!wire) return;
    const { remappedFrom } = applyServerConversation(repos, wire);
    if (remappedFrom) emit(IPC_EVENTS.CONVERSATION_ID_CHANGED, { old_id: remappedFrom, new_id: String(wire.id) });
    view.emitConversation(wire.id);
  }

  function onConversationDeleted(data) {
    const id = data && data.conversation_id;
    if (!id) return;
    // Bị xóa khỏi nhóm / nhóm bị xóa → bỏ cache local của conversation đó
    repos.transaction(() => {
      repos.messages.deleteByConversation(id);
      repos.conversations.remove(id);
    });
    log.info(LOG_CATEGORY.MESSAGE, 'conversation_removed', { conversation_id: id });
    view.emitConversationRemoved(id);
  }

  function onPinned(data) {
    if (!data || !data.conversation_id) return;
    repos.conversations.setPinned(data.conversation_id, data.pinned || []);
    emit(IPC_EVENTS.PINNED, { conversation_id: String(data.conversation_id), pinned: data.pinned || [] });
  }

  function onMemberPending(data) {
    if (!data || !data.conversation_id) return;
    repos.conversations.setPendingCount(data.conversation_id, data.pending_count || 0);
    emit(IPC_EVENTS.PENDING, { conversation_id: String(data.conversation_id), pending_count: data.pending_count || 0 });
  }

  function onUser(data) {
    const user = data && data.user;
    if (!user) return;
    const row = repos.users.upsert(user);
    emit(IPC_EVENTS.USERS, { users: [toLocalUser(row)] });
  }

  function onPresenceList(data) {
    repos.users.setOnlineSet((data && data.online_user_ids) || []);
    view.emitUsers(repos.users.list());
  }

  function onPresence(data) {
    if (!data || data.user_id == null) return;
    repos.users.setOnline(data.user_id, !!data.online);
    emit(IPC_EVENTS.PRESENCE, { user_id: data.user_id, online: !!data.online });
  }

  function onTyping(data) {
    if (!data || Number(data.user_id) === Number(myId())) return;
    emit(IPC_EVENTS.TYPING, { conversation_id: String(data.conversation_id), user_id: data.user_id, display_name: data.display_name || '' });
  }

  const handlers = {
    [MESSAGE.NEW]: onMessageNew,
    [MESSAGE.EDITED]: onMessageEdited,
    [MESSAGE.RECALLED]: onMessageRecalled,
    [MESSAGE.STATUS_UPDATE]: onStatusUpdate,
    [CONV.CREATED]: onConversation,
    [CONV.UPDATED]: onConversation,
    [CONV.DELETED]: onConversationDeleted,
    [CONV.PINNED]: onPinned,
    [CONV.UNPINNED]: onPinned,
    [CONV.MEMBER_PENDING]: onMemberPending,
    [USER.CREATED]: onUser,
    [USER.UPDATED]: onUser,
    [PRESENCE.LIST]: onPresenceList,
    [PRESENCE.UPDATE]: onPresence,
    [TYPING.TYPING]: onTyping,
  };

  /**
   * Xử lý 1 push frame. Lỗi DB được log, không làm sập kết nối.
   * @param {{type: string, data?: object}} frame
   */
  function handle(frame) {
    try {
      if (CALL_TYPES.has(frame.type)) {
        emit(IPC_EVENTS.CALL, { type: frame.type, data: frame.data || {} });
        return;
      }
      const fn = handlers[frame.type];
      if (fn) fn(frame.data || {});
    } catch (err) {
      log.error(LOG_CATEGORY.ERROR, 'inbound_frame_failed', { type: frame.type, message: err.message });
    }
  }

  return { handle };
}

module.exports = { createInboundHandler, applyServerConversation, remapConversationId };
