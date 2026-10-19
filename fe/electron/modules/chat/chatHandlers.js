/**
 * IPC: chat (main tự chọn đường server / P2P / queue).
 */
'use strict';

const { IPC_INVOKE: I } = require('../../../ipc/channels');

/**
 * @param {{ chat: import('./chatService').ChatService }} ctx
 */
function createChatHandlers(ctx) {
  const { chat } = ctx;
  return {
    [I.CHAT_SEND_TEXT]: (p) => chat.sendText(p),
    [I.CHAT_SEND_FILE]: (p) => chat.sendFile(p),
    [I.CHAT_CANCEL_UPLOAD]: (p) => chat.cancelUpload(p.client_message_id),
    [I.CHAT_RETRY]: (p) => chat.retry(p.client_message_id),
    [I.CHAT_EDIT]: (p) => chat.edit(p.conversation_id, p.client_message_id, p.content),
    [I.CHAT_RECALL]: (p) => chat.recall(p.conversation_id, p.client_message_id),
    [I.CHAT_PIN]: (p) => chat.pin(p.conversation_id, p.client_message_id),
    [I.CHAT_UNPIN]: (p) => chat.unpin(p.conversation_id, p.client_message_id),
    [I.CHAT_MARK_READ]: (p) => chat.markRead(p.conversation_id),
    [I.CHAT_TYPING]: (p) => chat.typing(p.conversation_id),
    [I.CHAT_OPEN_DIRECT]: (p) => chat.openDirect(p.user_id),
    [I.CHAT_CREATE_GROUP]: (p) => chat.createGroup(p.name, p.member_ids),
    [I.CHAT_RENAME_GROUP]: (p) => chat.renameGroup(p.conversation_id, p.name),
    [I.CHAT_GROUP_ACTION]: (p) => chat.groupAction(p.action, p.data || {}),
    [I.CHAT_LOAD_OLDER_FROM_SERVER]: (p) => chat.loadOlderFromServer(p.conversation_id),
  };
}

module.exports = { createChatHandlers };
