/**
 * Đóng gói / giải mã frame WebSocket + chuẩn hóa shape object trên dây (wire format).
 * Pure function — không I/O.
 *
 * Shape chuẩn (xem docs/PROTOCOL.md):
 *   WireUser, WireMessage, WireConversation, WireFile
 *
 * ⚠️ DUPLICATE ở be/src/shared và fe/shared — sửa xong chạy `npm run sync:shared`.
 */
'use strict';

/**
 * Tạo frame JSON để gửi qua WS.
 * @param {string} type  tên event (từ wsEvents)
 * @param {object} [data]
 * @param {{ reqId?: string, error?: { code: string, message: string } }} [extra]
 * @returns {string}
 */
function encodeFrame(type, data, extra) {
  const frame = { type };
  if (data !== undefined) frame.data = data;
  if (extra && extra.reqId) frame.reqId = extra.reqId;
  if (extra && extra.error) frame.error = extra.error;
  return JSON.stringify(frame);
}

/**
 * Giải mã frame. Không throw — trả null nếu sai định dạng.
 * @param {string|Buffer} raw
 * @returns {{ type: string, data?: any, reqId?: string, error?: any } | null}
 */
function decodeFrame(raw) {
  try {
    const parsed = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf8'));
    if (!parsed || typeof parsed.type !== 'string') return null;
    return parsed;
  } catch (_err) {
    return null;
  }
}

/** Parse JSON an toàn, trả fallback khi lỗi/null. */
function safeJsonParse(text, fallback) {
  if (text == null || text === '') return fallback;
  if (typeof text === 'object') return text;
  try {
    return JSON.parse(text);
  } catch (_err) {
    return fallback;
  }
}

/**
 * @typedef {{ id:number, username:string, employee_id:string, display_name:string,
 *   avatar:string|null, role:string, online?:boolean }} WireUser
 */
function toWireUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    employee_id: row.employee_id,
    display_name: row.display_name,
    avatar: row.avatar || null,
    role: row.role,
    ...(row.online !== undefined ? { online: !!row.online } : {}),
  };
}

/**
 * @typedef {{ id:number, sha256:string, name:string, size:number, mime_type:string,
 *   has_thumb:boolean, width:number|null, height:number|null }} WireFile
 */
function toWireFile(row) {
  if (!row) return null;
  return {
    id: row.id,
    sha256: row.sha256,
    name: row.original_name || row.name,
    size: row.size,
    mime_type: row.mime_type,
    has_thumb: !!row.has_thumb,
    width: row.width == null ? null : row.width,
    height: row.height == null ? null : row.height,
  };
}

/**
 * @typedef {{ server_id:number|null, client_message_id:string, conversation_id:string,
 *   sender_id:number, type:string, content:string, reply_to:string|null, file:WireFile|null,
 *   mentions:number[], edited:boolean, recalled:boolean, vector_clock:Object<string,number>,
 *   created_at:string|null, created_at_local:string|null, updated_at:string|null }} WireMessage
 *
 * conversation_id luôn là STRING trên dây (id server dạng "12", id tạm dạng "temp-<uuid>").
 */
function toWireMessage(row, fileRow) {
  if (!row) return null;
  const recalled = !!row.recalled;
  return {
    server_id: row.server_id != null ? row.server_id : row.id != null ? row.id : null,
    client_message_id: row.client_message_id,
    conversation_id: String(row.conversation_id),
    sender_id: row.sender_id,
    type: row.type,
    // Tin đã thu hồi: không gửi nội dung/file gốc đi nữa
    content: recalled ? '' : row.content || '',
    reply_to: row.reply_to || null,
    file: recalled ? null : fileRow ? toWireFile(fileRow) : safeJsonParse(row.file, null),
    mentions: safeJsonParse(row.mentions, []),
    edited: !!row.edited,
    recalled,
    vector_clock: safeJsonParse(row.vector_clock, {}),
    created_at: row.created_at || null,
    created_at_local: row.created_at_local || null,
    updated_at: row.updated_at || null,
  };
}

/**
 * @typedef {{ user_id:number, role:string, last_read_message_id:number, last_delivered_message_id:number }} WireMember
 * @typedef {{ client_message_id:string, server_id:number, sender_id:number, content_preview:string,
 *   type:string, pinned_by:number, pinned_at:string }} WirePin
 * @typedef {{ id:string, type:string, name:string|null, owner_id:number|null, version:number,
 *   client_temp_id:string|null, created_at:string, updated_at:string, members:WireMember[],
 *   pending_count:number, pinned:WirePin[], last_message:WireMessage|null }} WireConversation
 */
function toWireConversation(row, extra) {
  if (!row) return null;
  const e = extra || {};
  return {
    id: String(row.id),
    type: row.type,
    name: row.name || null,
    owner_id: row.owner_id == null ? null : row.owner_id,
    version: row.version || 1,
    client_temp_id: row.client_temp_id || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    members: (e.members || []).map((m) => ({
      user_id: m.user_id,
      role: m.role,
      last_read_message_id: m.last_read_message_id || 0,
      last_delivered_message_id: m.last_delivered_message_id || 0,
    })),
    pending_count: e.pending_count || 0,
    pinned: e.pinned || [],
    last_message: e.last_message || null,
  };
}

/** Rút gọn nội dung cho preview (pin, reply, notification). */
function previewText(content, max) {
  const flat = String(content || '').replace(/\s+/g, ' ').trim();
  const limit = max || 100;
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
}

module.exports = {
  encodeFrame,
  decodeFrame,
  safeJsonParse,
  toWireUser,
  toWireFile,
  toWireMessage,
  toWireConversation,
  previewText,
};
