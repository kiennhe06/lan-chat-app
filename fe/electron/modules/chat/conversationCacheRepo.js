/**
 * Repository bảng `conversations_cache`. id luôn là TEXT ("12" hoặc "temp-<uuid>").
 */
'use strict';

const { SYNC_STATE, CONVERSATION_TYPE } = require('../../../shared/constants');
const { safeJsonParse } = require('../../../shared/serializer');

function parseRow(row) {
  if (!row) return null;
  return {
    ...row,
    members: safeJsonParse(row.members, []),
    pinned: safeJsonParse(row.pinned, []),
  };
}

const maxIso = (a, b) => (!a ? b || null : !b ? a : a > b ? a : b);

/**
 * @param {import('better-sqlite3').Database} db
 */
function createConversationCacheRepo(db) {
  const stmt = {
    get: db.prepare('SELECT * FROM conversations_cache WHERE id = ?'),
    list: db.prepare(
      'SELECT * FROM conversations_cache ORDER BY COALESCE(last_message_at, updated_at, created_at) DESC',
    ),
    upsert: db.prepare(`
      INSERT INTO conversations_cache (id, type, name, owner_id, members, pinned, pending_count, unread_count,
        last_message_at, created_at, updated_at, version, sync_state, client_temp_id, updated_by)
      VALUES (@id, @type, @name, @owner_id, @members, @pinned, @pending_count, @unread_count,
        @last_message_at, @created_at, @updated_at, @version, @sync_state, @client_temp_id, @updated_by)
      ON CONFLICT(id) DO UPDATE SET
        type = excluded.type, name = excluded.name, owner_id = excluded.owner_id, members = excluded.members,
        pinned = excluded.pinned, pending_count = excluded.pending_count,
        last_message_at = excluded.last_message_at, created_at = excluded.created_at,
        updated_at = excluded.updated_at, version = excluded.version, sync_state = excluded.sync_state,
        client_temp_id = excluded.client_temp_id, updated_by = excluded.updated_by`),
    remove: db.prepare('DELETE FROM conversations_cache WHERE id = ?'),
    setUnread: db.prepare('UPDATE conversations_cache SET unread_count = ? WHERE id = ?'),
    incUnread: db.prepare('UPDATE conversations_cache SET unread_count = unread_count + ? WHERE id = ?'),
    setPinned: db.prepare('UPDATE conversations_cache SET pinned = ? WHERE id = ?'),
    setPending: db.prepare('UPDATE conversations_cache SET pending_count = ? WHERE id = ?'),
    setMembers: db.prepare('UPDATE conversations_cache SET members = ? WHERE id = ?'),
    touch: db.prepare(
      'UPDATE conversations_cache SET last_message_at = ? WHERE id = ? AND (last_message_at IS NULL OR last_message_at < ?)',
    ),
    setSyncState: db.prepare('UPDATE conversations_cache SET sync_state = ? WHERE id = ?'),
    rename: db.prepare(
      'UPDATE conversations_cache SET name = ?, version = ?, updated_at = ?, updated_by = ?, sync_state = ? WHERE id = ?',
    ),
    changeId: db.prepare('UPDATE conversations_cache SET id = ?, client_temp_id = ? WHERE id = ?'),
    totalUnread: db.prepare('SELECT COALESCE(SUM(unread_count), 0) AS n FROM conversations_cache'),
    byState: db.prepare('SELECT * FROM conversations_cache WHERE sync_state = ?'),
    byTempId: db.prepare('SELECT * FROM conversations_cache WHERE client_temp_id = ?'),
  };

  const get = (id) => parseRow(stmt.get.get(String(id)));

  /**
   * Upsert từ WireConversation. Giữ unread_count local; last_message_at = max(local, server).
   * @param {object} wire
   * @param {{ sync_state?: string, updated_by?: number|null }} [opts]
   */
  function upsertFromWire(wire, opts) {
    const id = String(wire.id);
    const existing = stmt.get.get(id);
    const lastFromWire = wire.last_message ? wire.last_message.created_at || wire.last_message.created_at_local : null;
    stmt.upsert.run({
      id,
      type: wire.type,
      name: wire.name || null,
      owner_id: wire.owner_id ?? null,
      members: JSON.stringify(wire.members || []),
      pinned: JSON.stringify(wire.pinned || []),
      pending_count: wire.pending_count || 0,
      unread_count: existing ? existing.unread_count : 0,
      last_message_at: maxIso(existing && existing.last_message_at, lastFromWire),
      created_at: wire.created_at || (existing && existing.created_at) || null,
      updated_at: wire.updated_at || (existing && existing.updated_at) || null,
      version: wire.version || 1,
      sync_state: (opts && opts.sync_state) || SYNC_STATE.SYNCED,
      client_temp_id: wire.client_temp_id || (existing && existing.client_temp_id) || null,
      updated_by: (opts && opts.updated_by) ?? (existing && existing.updated_by) ?? null,
    });
    return get(id);
  }

  /**
   * Đổi id tạm → id thật. Nếu bản id thật đã tồn tại (server broadcast tới trước) thì gộp unread và xóa bản tạm.
   * @returns {boolean} có thay đổi không
   */
  const remapId = db.transaction((oldId, newId) => {
    const temp = stmt.get.get(String(oldId));
    if (!temp) return false;
    const real = stmt.get.get(String(newId));
    if (real) {
      stmt.incUnread.run(temp.unread_count || 0, String(newId));
      stmt.remove.run(String(oldId));
    } else {
      stmt.changeId.run(String(newId), String(oldId), String(oldId));
    }
    return true;
  });

  /**
   * Cập nhật con trỏ delivered/read của 1 member (chỉ tiến).
   * @returns {object|null} conversation sau cập nhật
   */
  const updateMemberCursor = db.transaction((id, userId, delivered, read) => {
    const row = stmt.get.get(String(id));
    if (!row) return null;
    const members = safeJsonParse(row.members, []);
    const m = members.find((x) => Number(x.user_id) === Number(userId));
    if (!m) return parseRow(row);
    m.last_delivered_message_id = Math.max(m.last_delivered_message_id || 0, delivered || 0, read || 0);
    m.last_read_message_id = Math.max(m.last_read_message_id || 0, read || 0);
    stmt.setMembers.run(JSON.stringify(members), String(id));
    return get(id);
  });

  /** Tìm chat 1-1 giữa 2 user */
  function findDirectWith(myUserId, otherUserId) {
    for (const row of stmt.list.all()) {
      if (row.type !== CONVERSATION_TYPE.DIRECT) continue;
      const ids = safeJsonParse(row.members, []).map((m) => Number(m.user_id));
      if (ids.includes(Number(myUserId)) && ids.includes(Number(otherUserId)) && ids.length <= 2) return parseRow(row);
    }
    return null;
  }

  return {
    get,
    list: () => stmt.list.all().map(parseRow),
    upsertFromWire,
    /** Thêm conversation tạo local (offline) */
    insertLocal: (conv, syncState) => upsertFromWire(conv, { sync_state: syncState }),
    remove: (id) => stmt.remove.run(String(id)).changes,
    setUnread: (id, n) => stmt.setUnread.run(Math.max(0, n | 0), String(id)).changes,
    incrementUnread: (id, by) => stmt.incUnread.run(by || 1, String(id)).changes,
    setPinned: (id, pinned) => stmt.setPinned.run(JSON.stringify(pinned || []), String(id)).changes,
    setPendingCount: (id, n) => stmt.setPending.run(n | 0, String(id)).changes,
    touchLastMessage: (id, at) => (at ? stmt.touch.run(at, String(id), at).changes : 0),
    setSyncState: (id, state) => stmt.setSyncState.run(state, String(id)).changes,
    applyRename: (id, { name, version, updated_at, updated_by, sync_state }) =>
      stmt.rename.run(name, version, updated_at, updated_by ?? null, sync_state, String(id)).changes,
    remapId,
    updateMemberCursor,
    findDirectWith,
    totalUnread: () => stmt.totalUnread.get().n,
    listBySyncState: (state) => stmt.byState.all(state).map(parseRow),
    getByTempId: (tempId) => parseRow(stmt.byTempId.get(tempId)),
  };
}

module.exports = { createConversationCacheRepo };
