/**
 * Repository bảng sessions (jti của session token) — phục vụ thu hồi token.
 */
'use strict';

/**
 * @param {import('better-sqlite3').Database} db
 */
function createSessionRepo(db) {
  const stmts = {
    insert: db.prepare(
      'INSERT INTO sessions (jti, user_id, issued_at, expires_at, revoked, ip) VALUES (@jti, @user_id, @issued_at, @expires_at, 0, @ip)'
    ),
    findByJti: db.prepare('SELECT * FROM sessions WHERE jti = ?'),
    revoke: db.prepare('UPDATE sessions SET revoked = 1 WHERE jti = ?'),
    revokeOthers: db.prepare('UPDATE sessions SET revoked = 1 WHERE user_id = ? AND jti <> ? AND revoked = 0'),
    deleteExpired: db.prepare('DELETE FROM sessions WHERE expires_at < ?'),
  };
  return {
    insert: (s) => stmts.insert.run(s).changes,
    findByJti: (jti) => stmts.findByJti.get(jti),
    revoke: (jti) => stmts.revoke.run(jti).changes,
    /** Thu hồi mọi session khác của user (đổi mật khẩu). */
    revokeOthers: (userId, keepJti) => stmts.revokeOthers.run(userId, keepJti).changes,
    deleteExpired: (nowIso) => stmts.deleteExpired.run(nowIso).changes,
  };
}

module.exports = { createSessionRepo };
