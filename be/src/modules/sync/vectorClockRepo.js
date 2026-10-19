/**
 * Repository bảng vector_clocks: server giữ counter lớn nhất đã thấy cho từng user.
 */
'use strict';

/**
 * @param {import('better-sqlite3').Database} db
 */
function createVectorClockRepo(db) {
  const stmts = {
    upsertMax: db.prepare(`
      INSERT INTO vector_clocks (user_id, counter) VALUES (?, ?)
      ON CONFLICT(user_id) DO UPDATE SET counter = MAX(counter, excluded.counter)`),
    get: db.prepare('SELECT counter FROM vector_clocks WHERE user_id = ?'),
    all: db.prepare('SELECT user_id, counter FROM vector_clocks'),
  };
  return {
    upsertMax: (userId, counter) => stmts.upsertMax.run(userId, counter).changes,
    get: (userId) => {
      const row = stmts.get.get(userId);
      return row ? row.counter : 0;
    },
    all: () => stmts.all.all(),
  };
}

module.exports = { createVectorClockRepo };
