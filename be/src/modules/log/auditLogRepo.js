/**
 * Repository bảng audit_log (chỉ level audit/error) + client_log_ids (chống ghi trùng log client).
 */
'use strict';

/**
 * @param {import('better-sqlite3').Database} db
 */
function createAuditLogRepo(db) {
  const stmts = {
    insert: db.prepare(`
      INSERT INTO audit_log (ts, level, category, action, user_id, client_id, ip, meta, source)
      VALUES (@ts, @level, @category, @action, @user_id, @client_id, @ip, @meta, @source)`),
    deleteOlderThan: db.prepare('DELETE FROM audit_log WHERE ts < ?'),
    markClientLog: db.prepare('INSERT OR IGNORE INTO client_log_ids (log_id, received_at) VALUES (?, ?)'),
    pruneClientLogIds: db.prepare('DELETE FROM client_log_ids WHERE received_at < ?'),
  };
  return {
    insert: (row) => stmts.insert.run(row).changes,
    deleteOlderThan: (ts) => stmts.deleteOlderThan.run(ts).changes,
    /** @returns {boolean} true nếu log_id mới (chưa từng nhận) */
    markClientLog: (logId, nowIso) => stmts.markClientLog.run(logId, nowIso).changes === 1,
    pruneClientLogIds: (beforeIso) => stmts.pruneClientLogIds.run(beforeIso).changes,
  };
}

module.exports = { createAuditLogRepo };
