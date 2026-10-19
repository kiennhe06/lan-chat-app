/**
 * Repository bảng `settings` (key/value, value lưu JSON).
 */
'use strict';

const { safeJsonParse } = require('../../../shared/serializer');
const { nowIso } = require('../utils/time');

/**
 * @param {import('better-sqlite3').Database} db
 */
function createSettingsRepo(db) {
  const stmt = {
    get: db.prepare('SELECT value FROM settings WHERE key = ?'),
    set: db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`),
    del: db.prepare('DELETE FROM settings WHERE key = ?'),
  };
  return {
    /** @returns {any} giá trị đã parse JSON, hoặc fallback */
    get(key, fallback = null) {
      const row = stmt.get.get(key);
      return row ? safeJsonParse(row.value, fallback) : fallback;
    },
    set(key, value) {
      stmt.set.run(key, JSON.stringify(value === undefined ? null : value), nowIso());
    },
    delete(key) {
      return stmt.del.run(key).changes;
    },
  };
}

module.exports = { createSettingsRepo };
