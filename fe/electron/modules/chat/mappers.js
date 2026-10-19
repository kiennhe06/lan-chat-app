/**
 * Chuyển row client.db → shape gửi renderer (PROTOCOL §12):
 *   LocalMessage      = WireMessage + {local_id, status, sync_state, local_path, p2p_receipts, sort_key, upload_percent?}
 *   LocalConversation = WireConversation + {unread_count, sync_state, last_message_at, my_role}
 *   LocalUser         = WireUser + {online}
 */
'use strict';

const { MESSAGES_VI } = require('../../../shared/constants');

/**
 * @param {object} row đã parse bởi messageRepo
 * @param {{ upload_percent?: number }} [extra]
 */
function toLocalMessage(row, extra) {
  if (!row) return null;
  const recalled = !!row.recalled;
  return {
    server_id: row.server_id ?? null,
    client_message_id: row.client_message_id,
    conversation_id: String(row.conversation_id),
    sender_id: row.sender_id,
    type: row.type,
    content: recalled ? '' : row.content || '',
    reply_to: row.reply_to || null,
    file: recalled ? null : row.file || null,
    mentions: row.mentions || [],
    edited: !!row.edited,
    recalled,
    recalled_text: recalled ? MESSAGES_VI.RECALLED : undefined,
    vector_clock: row.vector_clock || {},
    created_at: row.created_at || null,
    created_at_local: row.created_at_local || null,
    updated_at: row.updated_at || null,
    local_id: row.local_id,
    status: row.status,
    sync_state: row.sync_state,
    local_path: row.local_path || null,
    p2p_receipts: row.p2p_receipts || {},
    sort_key: row.sort_key,
    last_error: row.last_error || null,
    ...(extra && extra.upload_percent !== undefined ? { upload_percent: extra.upload_percent } : {}),
  };
}

/**
 * @param {object} row đã parse bởi conversationCacheRepo
 * @param {number|null} myUserId
 * @param {object|null} lastMessageRow tin cuối (messageRepo row)
 */
function toLocalConversation(row, myUserId, lastMessageRow) {
  if (!row) return null;
  const members = (row.members || []).map((m) => ({
    user_id: Number(m.user_id),
    role: m.role,
    last_read_message_id: m.last_read_message_id || 0,
    last_delivered_message_id: m.last_delivered_message_id || 0,
  }));
  const me = members.find((m) => m.user_id === Number(myUserId));
  const last = lastMessageRow ? toLocalMessage(lastMessageRow) : null;
  return {
    id: String(row.id),
    type: row.type,
    name: row.name || null,
    owner_id: row.owner_id ?? null,
    version: row.version || 1,
    client_temp_id: row.client_temp_id || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    members,
    pending_count: row.pending_count || 0,
    pinned: row.pinned || [],
    last_message: last,
    unread_count: row.unread_count || 0,
    sync_state: row.sync_state,
    last_message_at: row.last_message_at || (last && (last.created_at || last.created_at_local)) || row.updated_at || null,
    my_role: me ? me.role : null,
  };
}

function toLocalUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    employee_id: row.employee_id,
    display_name: row.display_name,
    avatar: row.avatar || null,
    role: row.role,
    online: !!row.online,
  };
}

module.exports = { toLocalMessage, toLocalConversation, toLocalUser };
