/**
 * Repository bảng action_queue phía server: lưu kết quả các action offline client đã đẩy lên
 * (khóa = user_id + client_action_id) → gửi lại batch là idempotent.
 */
'use strict';

/**
 * @param {import('better-sqlite3').Database} db
 */
function createActionQueueRepo(db) {
  const stmts = {
    find: db.prepare('SELECT * FROM action_queue WHERE user_id = ? AND client_action_id = ?'),
    insert: db.prepare(`
      INSERT OR REPLACE INTO action_queue (client_action_id, user_id, action_type, ok, result, created_at)
      VALUES (@client_action_id, @user_id, @action_type, @ok, @result, @created_at)`),
    deleteOlderThan: db.prepare('DELETE FROM action_queue WHERE created_at < ?'),
  };
  return {
    find: (userId, clientActionId) => stmts.find.get(userId, clientActionId),
    insert: (row) => stmts.insert.run(row).changes,
    deleteOlderThan: (iso) => stmts.deleteOlderThan.run(iso).changes,
  };
}

module.exports = { createActionQueueRepo };
