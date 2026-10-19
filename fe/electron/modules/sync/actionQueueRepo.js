/**
 * Repository bảng `action_queue` — thao tác offline chờ đẩy lên server (conv_create, rename, edit, recall).
 */
'use strict';

const crypto = require('crypto');
const { safeJsonParse } = require('../../../shared/serializer');
const { nowIso } = require('../../core/utils/time');

function parseRow(row) {
  if (!row) return null;
  return { ...row, payload: safeJsonParse(row.payload, {}), vector_clock: safeJsonParse(row.vector_clock, {}) };
}

/**
 * @param {import('better-sqlite3').Database} db
 */
function createActionQueueRepo(db) {
  const stmt = {
    insert: db.prepare(`INSERT INTO action_queue (action_type, payload, vector_clock, created_at, client_action_id)
      VALUES (?, ?, ?, ?, ?)`),
    listAll: db.prepare('SELECT * FROM action_queue ORDER BY id ASC'),
    get: db.prepare('SELECT * FROM action_queue WHERE id = ?'),
    remove: db.prepare('DELETE FROM action_queue WHERE id = ?'),
    fail: db.prepare('UPDATE action_queue SET retry_count = retry_count + 1, last_error = ? WHERE id = ?'),
    setPayload: db.prepare('UPDATE action_queue SET payload = ? WHERE id = ?'),
    count: db.prepare('SELECT COUNT(*) AS c FROM action_queue'),
  };

  return {
    /** @returns {object} action vừa thêm */
    enqueue(actionType, payload, vectorClock) {
      const info = stmt.insert.run(
        actionType,
        JSON.stringify(payload || {}),
        JSON.stringify(vectorClock || {}),
        nowIso(),
        crypto.randomUUID(),
      );
      return parseRow(stmt.get.get(info.lastInsertRowid));
    },
    /** @param {string[]} [types] lọc theo loại */
    list(types) {
      const rows = stmt.listAll.all().map(parseRow);
      return types ? rows.filter((r) => types.includes(r.action_type)) : rows;
    },
    remove: (id) => stmt.remove.run(id).changes,
    markFailed: (id, error) => stmt.fail.run(String(error || ''), id).changes,
    updatePayload: (id, payload) => stmt.setPayload.run(JSON.stringify(payload || {}), id).changes,
    count: () => stmt.count.get().c,
    /** Thay id tạm bằng id thật trong payload các action còn lại */
    remapConversationId: db.transaction((oldId, newId) => {
      let changed = 0;
      for (const row of stmt.listAll.all()) {
        const payload = safeJsonParse(row.payload, {});
        if (payload.conversation_id === String(oldId)) {
          payload.conversation_id = String(newId);
          stmt.setPayload.run(JSON.stringify(payload), row.id);
          changed += 1;
        }
      }
      return changed;
    }),
  };
}

module.exports = { createActionQueueRepo };
