/**
 * Repository bảng messages. Các truy vấn danh sách JOIN sẵn files (cột tiền tố f_) để service dựng WireMessage.
 */
'use strict';

const SELECT_WITH_FILE = `
  SELECT m.*, f.id AS f_id, f.sha256 AS f_sha256, f.original_name AS f_original_name, f.size AS f_size,
    f.mime_type AS f_mime_type, f.has_thumb AS f_has_thumb, f.width AS f_width, f.height AS f_height
  FROM messages m LEFT JOIN files f ON f.id = m.file_id`;

/**
 * @param {import('better-sqlite3').Database} db
 */
function createMessageRepo(db) {
  const stmts = {
    insert: db.prepare(`
      INSERT INTO messages (client_message_id, conversation_id, sender_id, type, content, reply_to, file_id,
        mentions, vector_clock, created_at, created_at_local, updated_at)
      VALUES (@client_message_id, @conversation_id, @sender_id, @type, @content, @reply_to, @file_id,
        @mentions, @vector_clock, @created_at, @created_at_local, NULL)`),
    findById: db.prepare(`${SELECT_WITH_FILE} WHERE m.id = ?`),
    findByClientId: db.prepare(`${SELECT_WITH_FILE} WHERE m.client_message_id = ?`),
    listBefore: db.prepare(`${SELECT_WITH_FILE} WHERE m.conversation_id = ? AND m.id < ? ORDER BY m.id DESC LIMIT ?`),
    listLatest: db.prepare(`${SELECT_WITH_FILE} WHERE m.conversation_id = ? ORDER BY m.id DESC LIMIT ?`),
    // Tin mới hơn since trong các conversation user là member (mới nhất trước)
    listSinceForUser: db.prepare(`
      ${SELECT_WITH_FILE}
      WHERE m.id > ? AND m.conversation_id IN (SELECT conversation_id FROM conversation_members WHERE user_id = ?)
      ORDER BY m.id DESC LIMIT ?`),
    maxIdInConversation: db.prepare('SELECT COALESCE(MAX(id), 0) AS n FROM messages WHERE conversation_id = ?'),
    updateContent: db.prepare(
      'UPDATE messages SET content = ?, edited = 1, updated_at = ? WHERE client_message_id = ? AND recalled = 0'
    ),
    recall: db.prepare(
      "UPDATE messages SET recalled = 1, content = '', updated_at = ? WHERE client_message_id = ? AND recalled = 0"
    ),
    statsBySender: db.prepare(`
      SELECT sender_id,
             COUNT(*) AS messages_sent,
             SUM(CASE WHEN type IN ('image', 'file') THEN 1 ELSE 0 END) AS files_sent,
             MAX(created_at) AS last_message_at
      FROM messages WHERE type != 'system' GROUP BY sender_id`),
  };

  return {
    /** @returns {number} server_id */
    insert: (m) => Number(stmts.insert.run(m).lastInsertRowid),
    findById: (id) => stmts.findById.get(id),
    findByClientId: (cmid) => stmts.findByClientId.get(cmid),
    /** Trang lịch sử (mới nhất trước). beforeId null → trang mới nhất. */
    listPage: (convId, beforeId, limit) =>
      beforeId ? stmts.listBefore.all(convId, beforeId, limit) : stmts.listLatest.all(convId, limit),
    listSinceForUser: (userId, sinceId, limit) => stmts.listSinceForUser.all(sinceId, userId, limit),
    maxIdInConversation: (convId) => stmts.maxIdInConversation.get(convId).n,
    updateContent: (cmid, content, now) => stmts.updateContent.run(content, now, cmid).changes,
    recall: (cmid, now) => stmts.recall.run(now, cmid).changes,
    /** Thống kê tin đã gửi theo người gửi (bỏ tin system). */
    statsBySender: () => stmts.statsBySender.all(),
  };
}

module.exports = { createMessageRepo };
