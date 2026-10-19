/**
 * Dựng WireMessage / WireConversation từ dữ liệu local để gửi qua P2P hoặc sync.
 */
'use strict';

/** Row messageRepo → WireMessage (server_id giữ nguyên, có thể null) */
function messageToWire(row) {
  return {
    server_id: row.server_id ?? null,
    client_message_id: row.client_message_id,
    conversation_id: String(row.conversation_id),
    sender_id: row.sender_id,
    type: row.type,
    content: row.recalled ? '' : row.content || '',
    reply_to: row.reply_to || null,
    file: row.recalled ? null : row.file || null,
    mentions: row.mentions || [],
    edited: !!row.edited,
    recalled: !!row.recalled,
    vector_clock: row.vector_clock || {},
    created_at: row.created_at || null,
    created_at_local: row.created_at_local || null,
    updated_at: row.updated_at || null,
  };
}

/** Row conversationCacheRepo → WireConversation */
function conversationToWire(row) {
  return {
    id: String(row.id),
    type: row.type,
    name: row.name || null,
    owner_id: row.owner_id ?? null,
    version: row.version || 1,
    client_temp_id: row.client_temp_id || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    members: row.members || [],
    pending_count: 0,
    pinned: row.pinned || [],
    last_message: null,
  };
}

/** Danh sách user_id thành viên */
const memberIds = (conv) => ((conv && conv.members) || []).map((m) => Number(m.user_id));

module.exports = { messageToWire, conversationToWire, memberIds };
