/**
 * Repository conversations + conversation_members + pending_members + pinned_messages.
 * Chỉ SQL; quyền/luật nghiệp vụ nằm ở conversationService.
 */
'use strict';

/**
 * @param {import('better-sqlite3').Database} db
 */
function createConversationRepo(db) {
  const stmts = {
    countGroupsByUser: db.prepare(`
      SELECT m.user_id, COUNT(*) AS groups_count FROM conversation_members m
      JOIN conversations c ON c.id = m.conversation_id AND c.type = 'group' GROUP BY m.user_id`),
    insert: db.prepare(`
      INSERT INTO conversations (type, name, owner_id, direct_key, created_by, client_temp_id, version,
        name_updated_at, name_updated_by, created_at, updated_at)
      VALUES (@type, @name, @owner_id, @direct_key, @created_by, @client_temp_id, 1,
        COALESCE(@name_updated_at, @now), @created_by, @now, @now)`),
    findById: db.prepare('SELECT * FROM conversations WHERE id = ?'),
    findByDirectKey: db.prepare('SELECT * FROM conversations WHERE direct_key = ?'),
    findByClientTempId: db.prepare('SELECT * FROM conversations WHERE client_temp_id = ?'),
    listForUser: db.prepare(`
      SELECT c.* FROM conversations c
      JOIN conversation_members m ON m.conversation_id = c.id
      WHERE m.user_id = ? ORDER BY c.updated_at DESC, c.id DESC`),
    updateName: db.prepare(`
      UPDATE conversations SET name = @name, name_updated_at = @name_updated_at, name_updated_by = @name_updated_by,
        version = version + 1, updated_at = @now WHERE id = @id`),
    touch: db.prepare('UPDATE conversations SET version = version + 1, updated_at = ? WHERE id = ?'),
    setUpdatedAt: db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?'),
    remove: db.prepare('DELETE FROM conversations WHERE id = ?'),

    addMember: db.prepare(`
      INSERT OR IGNORE INTO conversation_members (conversation_id, user_id, role, joined_at)
      VALUES (?, ?, ?, ?)`),
    removeMember: db.prepare('DELETE FROM conversation_members WHERE conversation_id = ? AND user_id = ?'),
    getMember: db.prepare('SELECT * FROM conversation_members WHERE conversation_id = ? AND user_id = ?'),
    listMembers: db.prepare('SELECT * FROM conversation_members WHERE conversation_id = ? ORDER BY joined_at, user_id'),
    setRole: db.prepare('UPDATE conversation_members SET role = ? WHERE conversation_id = ? AND user_id = ?'),
    // Con trỏ chỉ tiến (MAX); đã đọc ⇒ đã nhận
    advanceCursors: db.prepare(`
      UPDATE conversation_members SET
        last_read_message_id = MAX(last_read_message_id, @read),
        last_delivered_message_id = MAX(last_delivered_message_id, @delivered, @read)
      WHERE conversation_id = @conversation_id AND user_id = @user_id`),

    addPending: db.prepare(`
      INSERT OR IGNORE INTO pending_members (conversation_id, user_id, requested_by, created_at) VALUES (?, ?, ?, ?)`),
    removePending: db.prepare('DELETE FROM pending_members WHERE conversation_id = ? AND user_id = ?'),
    getPending: db.prepare('SELECT * FROM pending_members WHERE conversation_id = ? AND user_id = ?'),
    listPending: db.prepare('SELECT * FROM pending_members WHERE conversation_id = ? ORDER BY created_at, user_id'),
    countPending: db.prepare('SELECT COUNT(*) AS n FROM pending_members WHERE conversation_id = ?'),

    addPin: db.prepare(`
      INSERT OR IGNORE INTO pinned_messages (conversation_id, client_message_id, pinned_by, pinned_at) VALUES (?, ?, ?, ?)`),
    removePin: db.prepare('DELETE FROM pinned_messages WHERE conversation_id = ? AND client_message_id = ?'),
    listPins: db.prepare(`
      SELECT p.client_message_id, p.pinned_by, p.pinned_at, m.id AS server_id, m.sender_id, m.content, m.type, m.recalled
      FROM pinned_messages p JOIN messages m ON m.client_message_id = p.client_message_id
      WHERE p.conversation_id = ? ORDER BY p.pinned_at DESC`),
  };

  return {
    insert: (c) => Number(stmts.insert.run({ name_updated_at: null, ...c }).lastInsertRowid),
    findById: (id) => stmts.findById.get(id),
    findByDirectKey: (key) => stmts.findByDirectKey.get(key),
    findByClientTempId: (tempId) => stmts.findByClientTempId.get(tempId),
    listForUser: (userId) => stmts.listForUser.all(userId),
    updateName: (p) => stmts.updateName.run(p).changes,
    touch: (id, now) => stmts.touch.run(now, id).changes,
    setUpdatedAt: (id, now) => stmts.setUpdatedAt.run(now, id).changes,
    remove: (id) => stmts.remove.run(id).changes,

    addMember: (convId, userId, role, now) => stmts.addMember.run(convId, userId, role, now).changes,
    removeMember: (convId, userId) => stmts.removeMember.run(convId, userId).changes,
    getMember: (convId, userId) => stmts.getMember.get(convId, userId),
    listMembers: (convId) => stmts.listMembers.all(convId),
    setRole: (convId, userId, role) => stmts.setRole.run(role, convId, userId).changes,
    advanceCursors: (p) => stmts.advanceCursors.run(p).changes,

    addPending: (convId, userId, requestedBy, now) => stmts.addPending.run(convId, userId, requestedBy, now).changes,
    removePending: (convId, userId) => stmts.removePending.run(convId, userId).changes,
    getPending: (convId, userId) => stmts.getPending.get(convId, userId),
    listPending: (convId) => stmts.listPending.all(convId),
    countPending: (convId) => stmts.countPending.get(convId).n,

    addPin: (convId, cmid, userId, now) => stmts.addPin.run(convId, cmid, userId, now).changes,
    removePin: (convId, cmid) => stmts.removePin.run(convId, cmid).changes,
    listPins: (convId) => stmts.listPins.all(convId),
    /** Số nhóm mỗi user đang tham gia. */
    countGroupsByUser: () => stmts.countGroupsByUser.all(),

    /** Chạy fn trong 1 transaction SQLite. */
    transaction: (fn) => db.transaction(fn)(),
  };
}

module.exports = { createConversationRepo };
