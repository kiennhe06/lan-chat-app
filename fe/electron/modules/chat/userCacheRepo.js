/**
 * Repository bảng `users_cache` (danh bạ + trạng thái online cache).
 */
'use strict';

const { nowIso } = require('../../core/utils/time');

function parseRow(row) {
  return row ? { ...row, online: !!row.online } : null;
}

/**
 * @param {import('better-sqlite3').Database} db
 */
function createUserCacheRepo(db) {
  const stmt = {
    upsert: db.prepare(`
      INSERT INTO users_cache (id, username, employee_id, display_name, avatar, role, online, updated_at)
      VALUES (@id, @username, @employee_id, @display_name, @avatar, @role, @online, @updated_at)
      ON CONFLICT(id) DO UPDATE SET username = excluded.username, employee_id = excluded.employee_id,
        display_name = excluded.display_name, avatar = excluded.avatar, role = excluded.role,
        online = COALESCE(@online_override, users_cache.online), updated_at = excluded.updated_at`),
    list: db.prepare('SELECT * FROM users_cache ORDER BY display_name COLLATE NOCASE'),
    get: db.prepare('SELECT * FROM users_cache WHERE id = ?'),
    setOnline: db.prepare('UPDATE users_cache SET online = ? WHERE id = ?'),
    allOffline: db.prepare('UPDATE users_cache SET online = 0'),
  };

  /** Upsert 1 WireUser. `online` chỉ ghi đè khi wire có field online. */
  function upsert(user) {
    const hasOnline = user.online !== undefined;
    stmt.upsert.run({
      id: user.id,
      username: user.username || null,
      employee_id: user.employee_id || null,
      display_name: user.display_name || null,
      avatar: user.avatar || null,
      role: user.role || null,
      online: hasOnline && user.online ? 1 : 0,
      online_override: hasOnline ? (user.online ? 1 : 0) : null,
      updated_at: nowIso(),
    });
    return parseRow(stmt.get.get(user.id));
  }

  const upsertMany = db.transaction((users) => (users || []).map(upsert));

  /** Đặt online theo tập id (mọi user khác → offline) */
  const setOnlineSet = db.transaction((ids) => {
    stmt.allOffline.run();
    for (const id of ids || []) stmt.setOnline.run(1, id);
  });

  return {
    upsert,
    upsertMany,
    list: () => stmt.list.all().map(parseRow),
    get: (id) => parseRow(stmt.get.get(id)),
    setOnline: (id, online) => stmt.setOnline.run(online ? 1 : 0, id).changes,
    setAllOffline: () => stmt.allOffline.run().changes,
    setOnlineSet,
  };
}

module.exports = { createUserCacheRepo };
