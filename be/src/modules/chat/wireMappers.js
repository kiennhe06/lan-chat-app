/**
 * Chuyển row DB (đã JOIN) → object trên dây, dùng chung giữa các service.
 */
'use strict';

const C = require('../../shared/constants');
const { toWireMessage, previewText } = require('../../shared/serializer');

/**
 * Row messages JOIN files (cột f_*) → WireMessage.
 * @param {object} row
 */
function messageRowToWire(row) {
  if (!row) return null;
  const fileRow =
    row.f_id != null
      ? {
          id: row.f_id,
          sha256: row.f_sha256,
          original_name: row.f_original_name,
          size: row.f_size,
          mime_type: row.f_mime_type,
          has_thumb: row.f_has_thumb,
          width: row.f_width,
          height: row.f_height,
        }
      : null;
  return toWireMessage({ ...row, server_id: row.id, file: null }, fileRow);
}

/**
 * Row pinned_messages JOIN messages → WirePin.
 * @param {object} row
 */
function pinRowToWire(row) {
  return {
    client_message_id: row.client_message_id,
    server_id: row.server_id,
    sender_id: row.sender_id,
    content_preview: row.recalled ? '' : previewText(row.content, C.PIN_PREVIEW_MAX_CHARS),
    type: row.type,
    pinned_by: row.pinned_by,
    pinned_at: row.pinned_at,
  };
}

module.exports = { messageRowToWire, pinRowToWire };
