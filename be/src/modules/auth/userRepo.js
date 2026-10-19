/**
 * Repository bảng users — chỉ SQL, không logic nghiệp vụ.
 * username / employee_id dùng COLLATE NOCASE → so khớp không phân biệt hoa thường, lưu case gốc.
 */
'use strict';

const C = require('../../shared/constants');

/**
 * @param {import('better-sqlite3').Database} db
 */
function createUserRepo(db) {
  const stmts = {
    // User đầu tiên của hệ thống = manager (quyết định nguyên tử trong cùng câu INSERT)
    insert: db.prepare(`
      INSERT INTO users (username, employee_id, display_name, password_hash, role, theme, created_at, updated_at)
      VALUES (@username, @employee_id, @display_name, @password_hash,
        CASE WHEN (SELECT COUNT(*) FROM users) = 0 THEN '${C.USER_ROLE.MANAGER}' ELSE '${C.USER_ROLE.MEMBER}' END,
        @theme, @now, @now)`),
    findById: db.prepare('SELECT * FROM users WHERE id = ?'),
    findByUsername: db.prepare('SELECT * FROM users WHERE username = ?'),
    findByEmployeeId: db.prepare('SELECT * FROM users WHERE employee_id = ?'),
    listAll: db.prepare('SELECT * FROM users ORDER BY display_name COLLATE NOCASE, id'),
    listByIds: db.prepare('SELECT * FROM users WHERE id IN (SELECT value FROM json_each(?))'),
    count: db.prepare('SELECT COUNT(*) AS n FROM users'),
    updateDisplayName: db.prepare('UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?'),
    updatePassword: db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?'),
    updateAvatar: db.prepare('UPDATE users SET avatar = ?, updated_at = ? WHERE id = ?'),
    updateTheme: db.prepare('UPDATE users SET theme = ?, updated_at = ? WHERE id = ?'),
    touchLogin: db.prepare('UPDATE users SET last_login_at = ?, last_login_ip = ? WHERE id = ?'),
  };

  return {
    /** @returns {number} id user mới */
    insert: (u) => Number(stmts.insert.run(u).lastInsertRowid),
    findById: (id) => stmts.findById.get(id),
    findByUsername: (username) => stmts.findByUsername.get(username),
    findByEmployeeId: (employeeId) => stmts.findByEmployeeId.get(employeeId),
    listAll: () => stmts.listAll.all(),
    listByIds: (ids) => stmts.listByIds.all(JSON.stringify(ids || [])),
    count: () => stmts.count.get().n,
    updateDisplayName: (id, name, now) => stmts.updateDisplayName.run(name, now, id).changes,
    updatePassword: (id, hash, now) => stmts.updatePassword.run(hash, now, id).changes,
    updateAvatar: (id, avatar, now) => stmts.updateAvatar.run(avatar, now, id).changes,
    updateTheme: (id, theme, now) => stmts.updateTheme.run(theme, now, id).changes,
    touchLogin: (id, now, ip) => stmts.touchLogin.run(now, ip || null, id).changes,
  };
}

module.exports = { createUserRepo };
