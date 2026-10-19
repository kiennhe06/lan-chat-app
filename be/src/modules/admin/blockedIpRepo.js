/**
 * Repository bảng blocked_ips.
 */
'use strict';

/**
 * @param {import('better-sqlite3').Database} db
 */
function createBlockedIpRepo(db) {
  const stmts = {
    upsert: db.prepare(`
      INSERT INTO blocked_ips (ip, reason, blocked_by, created_at) VALUES (@ip, @reason, @blocked_by, @created_at)
      ON CONFLICT(ip) DO UPDATE SET reason = excluded.reason, blocked_by = excluded.blocked_by`),
    find: db.prepare('SELECT * FROM blocked_ips WHERE ip = ?'),
    remove: db.prepare('DELETE FROM blocked_ips WHERE ip = ?'),
    list: db.prepare('SELECT * FROM blocked_ips ORDER BY created_at DESC'),
  };
  return {
    upsert: (row) => stmts.upsert.run(row).changes,
    find: (ip) => stmts.find.get(ip),
    remove: (ip) => stmts.remove.run(ip).changes,
    list: () => stmts.list.all(),
  };
}

module.exports = { createBlockedIpRepo };
