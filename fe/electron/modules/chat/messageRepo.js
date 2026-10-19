/**
 * Repository bảng `messages` (client.db). Chỉ truy cập dữ liệu — không business logic.
 *
 * sort_key (khóa phân trang ổn định, so sánh chuỗi):
 *   - Tin đã có server_id: 'S' + server_id zero-pad 15 chữ số → đúng thứ tự server.
 *   - Tin chưa sync:       'U' + created_at_local + '|' + sender_id pad 10 + '|' + client_message_id
 *     → luôn đứng SAU mọi tin đã sync ('S' < 'U'); khi server cấp id thì re-key sang dạng 'S'.
 * Thứ tự hiển thị chính xác (nhân quả) do renderer sắp lại bằng vectorClock.compareMessages.
 */
'use strict';

const { PAGE_SIZE, SYNC_STATE, MESSAGE_STATUS, MESSAGE_STATUS_RANK, MESSAGE_TYPE } = require('../../../shared/constants');
const { safeJsonParse } = require('../../../shared/serializer');

const SERVER_ID_PAD = 15;
const SENDER_PAD = 10;

/**
 * Tính sort_key.
 * @param {{server_id?: number|null, created_at_local?: string|null, created_at?: string|null, sender_id: number, client_message_id: string}} m
 * @returns {string}
 */
function computeSortKey(m) {
  if (m.server_id != null) return `S${String(m.server_id).padStart(SERVER_ID_PAD, '0')}`;
  const ts = m.created_at_local || m.created_at || '';
  return `U${ts}|${String(m.sender_id || 0).padStart(SENDER_PAD, '0')}|${m.client_message_id}`;
}

/** Trạng thái chỉ tiến: trả về trạng thái có rank cao hơn */
function forwardStatus(current, next) {
  if (!current) return next;
  if (!next) return current;
  return (MESSAGE_STATUS_RANK[next] ?? -1) > (MESSAGE_STATUS_RANK[current] ?? -1) ? next : current;
}

/** Chuyển row DB → object (parse các cột JSON) */
function parseRow(row) {
  if (!row) return null;
  return {
    ...row,
    file: safeJsonParse(row.file, null),
    mentions: safeJsonParse(row.mentions, []),
    vector_clock: safeJsonParse(row.vector_clock, {}),
    p2p_receipts: safeJsonParse(row.p2p_receipts, {}),
    edited: !!row.edited,
    recalled: !!row.recalled,
  };
}

const json = (v, fallback) => JSON.stringify(v == null ? fallback : v);

/** Danh sách sync_state "chưa lên server" */
const UNSYNCED_STATES = [SYNC_STATE.PENDING_SERVER, SYNC_STATE.PENDING_PEER, SYNC_STATE.PARTIAL_PEER, SYNC_STATE.PEER_SYNCED];

/**
 * @param {import('better-sqlite3').Database} db
 */
function createMessageRepo(db) {
  const stmt = {
    getByCmid: db.prepare('SELECT * FROM messages WHERE client_message_id = ?'),
    getByServerId: db.prepare('SELECT * FROM messages WHERE server_id = ?'),
    insert: db.prepare(`
      INSERT OR IGNORE INTO messages (
        server_id, client_message_id, conversation_id, sender_id, type, content, reply_to, file, file_sha256,
        mentions, edited, recalled, status, sync_state, vector_clock, p2p_receipts, created_at, created_at_local,
        updated_at, local_path, sort_key, last_error
      ) VALUES (
        @server_id, @client_message_id, @conversation_id, @sender_id, @type, @content, @reply_to, @file, @file_sha256,
        @mentions, @edited, @recalled, @status, @sync_state, @vector_clock, @p2p_receipts, @created_at, @created_at_local,
        @updated_at, @local_path, @sort_key, @last_error
      )`),
    pageFirst: db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY sort_key DESC LIMIT ?'),
    pageBefore: db.prepare('SELECT * FROM messages WHERE conversation_id = ? AND sort_key < ? ORDER BY sort_key DESC LIMIT ?'),
    pageAfterInclusive: db.prepare(
      'SELECT * FROM messages WHERE conversation_id = ? AND sort_key >= ? ORDER BY sort_key ASC LIMIT ?',
    ),
    iterateConv: db.prepare(
      `SELECT * FROM messages WHERE conversation_id = ? AND recalled = 0 AND type != '${MESSAGE_TYPE.SYSTEM}' ORDER BY sort_key DESC`,
    ),
    mediaByType: db.prepare(
      'SELECT * FROM messages WHERE conversation_id = ? AND type = ? AND recalled = 0 ORDER BY sort_key DESC LIMIT ?',
    ),
    linksCandidates: db.prepare(
      "SELECT * FROM messages WHERE conversation_id = ? AND recalled = 0 AND content LIKE '%http%' ORDER BY sort_key DESC LIMIT ?",
    ),
    maxServerId: db.prepare('SELECT MAX(server_id) AS v FROM messages'),
    maxServerIdConv: db.prepare('SELECT MAX(server_id) AS v FROM messages WHERE conversation_id = ?'),
    minServerIdConv: db.prepare('SELECT MIN(server_id) AS v FROM messages WHERE conversation_id = ?'),
    latestInConv: db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY sort_key DESC LIMIT 1'),
    countAfterServerId: db.prepare(
      'SELECT COUNT(*) AS c FROM messages WHERE conversation_id = ? AND sender_id != ? AND server_id > ? AND type != ?',
    ),
    pathBySha: db.prepare(
      'SELECT local_path FROM messages WHERE file_sha256 = ? AND local_path IS NOT NULL ORDER BY local_id DESC',
    ),
    fileBySha: db.prepare('SELECT file FROM messages WHERE file_sha256 = ? AND file IS NOT NULL LIMIT 1'),
    setLocalPath: db.prepare('UPDATE messages SET local_path = ? WHERE client_message_id = ?'),
    setLocalPathBySha: db.prepare('UPDATE messages SET local_path = ? WHERE file_sha256 = ? AND local_path IS NULL'),
    remapConv: db.prepare('UPDATE messages SET conversation_id = ? WHERE conversation_id = ?'),
    deleteConv: db.prepare('DELETE FROM messages WHERE conversation_id = ?'),
  };

  const get = (cmid) => parseRow(stmt.getByCmid.get(cmid));

  /**
   * Thêm tin mới (bỏ qua nếu client_message_id đã tồn tại — idempotent).
   * @returns {{ inserted: boolean, message: object }}
   */
  function insert(m) {
    const row = {
      server_id: m.server_id ?? null,
      client_message_id: m.client_message_id,
      conversation_id: String(m.conversation_id),
      sender_id: m.sender_id,
      type: m.type,
      content: m.content || '',
      reply_to: m.reply_to || null,
      file: m.file ? JSON.stringify(m.file) : null,
      file_sha256: m.file_sha256 || (m.file && m.file.sha256) || null,
      mentions: json(m.mentions, []),
      edited: m.edited ? 1 : 0,
      recalled: m.recalled ? 1 : 0,
      status: m.status || MESSAGE_STATUS.PENDING,
      sync_state: m.sync_state || SYNC_STATE.SYNCED,
      vector_clock: json(m.vector_clock, {}),
      p2p_receipts: json(m.p2p_receipts, {}),
      created_at: m.created_at || null,
      created_at_local: m.created_at_local || null,
      updated_at: m.updated_at || null,
      local_path: m.local_path || null,
      sort_key: computeSortKey(m),
      last_error: m.last_error || null,
    };
    const info = stmt.insert.run(row);
    return { inserted: info.changes > 0, message: get(m.client_message_id) };
  }

  /**
   * Cập nhật một phần các cột (whitelist). Tự re-key khi server_id thay đổi.
   * @param {string} cmid
   * @param {object} patch
   */
  function update(cmid, patch) {
    const current = stmt.getByCmid.get(cmid);
    if (!current) return null;
    const allowed = [
      'server_id', 'conversation_id', 'content', 'reply_to', 'file', 'file_sha256', 'mentions', 'edited', 'recalled',
      'status', 'sync_state', 'vector_clock', 'p2p_receipts', 'created_at', 'updated_at', 'local_path', 'last_error',
    ];
    const sets = [];
    const params = { cmid };
    for (const key of allowed) {
      if (!(key in patch)) continue;
      let value = patch[key];
      if (['file', 'mentions', 'vector_clock', 'p2p_receipts'].includes(key)) value = value == null ? null : JSON.stringify(value);
      if (key === 'edited' || key === 'recalled') value = value ? 1 : 0;
      if (key === 'conversation_id' && value != null) value = String(value);
      sets.push(`${key} = @${key}`);
      params[key] = value;
    }
    const merged = { ...current, ...patch };
    if ('server_id' in patch) {
      sets.push('sort_key = @sort_key');
      params.sort_key = computeSortKey(merged);
    }
    if (!sets.length) return parseRow(current);
    db.prepare(`UPDATE messages SET ${sets.join(', ')} WHERE client_message_id = @cmid`).run(params);
    return get(cmid);
  }

  /**
   * Upsert tin từ server (WireMessage). Tin đã có → cập nhật nội dung/server_id, sync_state='synced',
   * status chỉ tiến (tối thiểu 'sent'). Giữ local_path/p2p_receipts local.
   * @returns {{ inserted: boolean, message: object }}
   */
  const upsertFromServer = db.transaction((wire) => {
    const existing = stmt.getByCmid.get(wire.client_message_id);
    if (!existing) {
      return insert({ ...wire, status: MESSAGE_STATUS.SENT, sync_state: SYNC_STATE.SYNCED });
    }
    const message = update(wire.client_message_id, {
      server_id: wire.server_id ?? existing.server_id,
      conversation_id: wire.conversation_id,
      content: wire.content || '',
      reply_to: wire.reply_to || null,
      file: wire.file || safeJsonParse(existing.file, null),
      file_sha256: (wire.file && wire.file.sha256) || existing.file_sha256,
      mentions: wire.mentions || [],
      edited: !!wire.edited,
      recalled: !!wire.recalled,
      created_at: wire.created_at || existing.created_at,
      updated_at: wire.updated_at || existing.updated_at,
      sync_state: SYNC_STATE.SYNCED,
      status: forwardStatus(existing.status === MESSAGE_STATUS.FAILED ? MESSAGE_STATUS.PENDING : existing.status, MESSAGE_STATUS.SENT),
      last_error: null,
    });
    return { inserted: false, message };
  });

  /**
   * Phân trang lịch sử theo sort_key (mới nhất trước), trả mảng TĂNG dần.
   * @param {string} conversationId
   * @param {string|null} before sort_key của tin cũ nhất đang hiển thị
   * @param {number} [limit]
   */
  function listPage(conversationId, before, limit) {
    const size = limit || PAGE_SIZE;
    const rows = before
      ? stmt.pageBefore.all(String(conversationId), before, size + 1)
      : stmt.pageFirst.all(String(conversationId), size + 1);
    const hasMore = rows.length > size;
    const page = rows.slice(0, size).reverse().map(parseRow);
    return { messages: page, has_more: hasMore, oldest_key: page.length ? page[0].sort_key : null };
  }

  /**
   * Cửa sổ quanh 1 tin (cũ hơn ~nửa trang + tin đó + mới hơn).
   * @returns {{messages: object[], has_more: boolean, oldest_key: string|null, has_newer: boolean} | null}
   */
  function listAround(conversationId, cmid, limit) {
    const target = stmt.getByCmid.get(cmid);
    if (!target || target.conversation_id !== String(conversationId)) return null;
    const half = Math.floor((limit || PAGE_SIZE) / 2);
    const older = stmt.pageBefore.all(String(conversationId), target.sort_key, half + 1);
    const newer = stmt.pageAfterInclusive.all(String(conversationId), target.sort_key, half + 2);
    const hasMore = older.length > half;
    const hasNewer = newer.length > half + 1;
    const rows = [...older.slice(0, half).reverse(), ...newer.slice(0, half + 1)].map(parseRow);
    return { messages: rows, has_more: hasMore, oldest_key: rows.length ? rows[0].sort_key : null, has_newer: hasNewer };
  }

  /**
   * Tìm theo từ khóa (không phân biệt hoa thường, đúng Unicode tiếng Việt — lọc ở JS vì LIKE chỉ fold ASCII).
   * @returns {object[]} mới nhất trước
   */
  function search(conversationId, keyword, limit) {
    const needle = String(keyword || '').normalize('NFC').toLocaleLowerCase('vi');
    if (!needle) return [];
    const out = [];
    for (const row of stmt.iterateConv.iterate(String(conversationId))) {
      const hay = `${row.content || ''} ${row.file ? safeJsonParse(row.file, {}).name || '' : ''}`
        .normalize('NFC')
        .toLocaleLowerCase('vi');
      if (hay.includes(needle)) {
        out.push(parseRow(row));
        if (out.length >= limit) break;
      }
    }
    return out;
  }

  /** Tin ảnh/file/link (mới nhất trước) */
  function listMedia(conversationId, type, limit) {
    return stmt.mediaByType.all(String(conversationId), type, limit).map(parseRow);
  }

  function listLinkCandidates(conversationId, limit) {
    return stmt.linksCandidates.all(String(conversationId), limit).map(parseRow);
  }

  /**
   * Tin chưa lên server cần đẩy trong sync (bỏ qua conversation còn id tạm — chờ conv_create map xong).
   * Gồm: tin của mình ở mọi trạng thái chưa sync + tin peer_synced của người khác.
   */
  function listForSync(myUserId, limit) {
    const placeholders = UNSYNCED_STATES.map(() => '?').join(',');
    return db
      .prepare(
        `SELECT * FROM messages
         WHERE sync_state IN (${placeholders})
           AND (sender_id = ? OR sync_state = ?)
           AND conversation_id NOT LIKE 'temp-%'
           AND type != ?
         ORDER BY sort_key ASC LIMIT ?`,
      )
      .all(...UNSYNCED_STATES, myUserId, SYNC_STATE.PEER_SYNCED, MESSAGE_TYPE.SYSTEM, limit)
      .map(parseRow);
  }

  /** Đếm tin chưa sync (của mình + peer_synced) */
  function countUnsynced(myUserId) {
    const placeholders = UNSYNCED_STATES.map(() => '?').join(',');
    const row = db
      .prepare(
        `SELECT COUNT(*) AS c FROM messages WHERE sync_state IN (${placeholders}) AND (sender_id = ? OR sync_state = ?)`,
      )
      .get(...UNSYNCED_STATES, myUserId, SYNC_STATE.PEER_SYNCED);
    return row.c;
  }

  /** Tin của mình chưa tới đủ peer (pending_peer / partial_peer) */
  function listAwaitingPeers(myUserId) {
    return db
      .prepare('SELECT * FROM messages WHERE sender_id = ? AND sync_state IN (?, ?) ORDER BY sort_key ASC')
      .all(myUserId, SYNC_STATE.PENDING_PEER, SYNC_STATE.PARTIAL_PEER)
      .map(parseRow);
  }

  /**
   * Cập nhật status tin của mình theo con trỏ delivered/read của người khác (chỉ tiến).
   * @returns {number} số dòng thay đổi
   */
  function advanceOwnStatuses(conversationId, myUserId, deliveredUpTo, readUpTo) {
    let changes = 0;
    if (readUpTo > 0) {
      changes += db
        .prepare(
          `UPDATE messages SET status = ? WHERE conversation_id = ? AND sender_id = ? AND server_id IS NOT NULL
           AND server_id <= ? AND status IN (?, ?, ?)`,
        )
        .run(MESSAGE_STATUS.READ, String(conversationId), myUserId, readUpTo, MESSAGE_STATUS.PENDING, MESSAGE_STATUS.SENT, MESSAGE_STATUS.DELIVERED).changes;
    }
    if (deliveredUpTo > 0) {
      changes += db
        .prepare(
          `UPDATE messages SET status = ? WHERE conversation_id = ? AND sender_id = ? AND server_id IS NOT NULL
           AND server_id <= ? AND status IN (?, ?)`,
        )
        .run(MESSAGE_STATUS.DELIVERED, String(conversationId), myUserId, deliveredUpTo, MESSAGE_STATUS.PENDING, MESSAGE_STATUS.SENT).changes;
    }
    return changes;
  }

  return {
    insert,
    update,
    get,
    getByServerId: (id) => parseRow(stmt.getByServerId.get(id)),
    upsertFromServer,
    listPage,
    listAround,
    search,
    listMedia,
    listLinkCandidates,
    listForSync,
    countUnsynced,
    listAwaitingPeers,
    advanceOwnStatuses,
    maxServerId: () => stmt.maxServerId.get().v || 0,
    maxServerIdInConversation: (cid) => stmt.maxServerIdConv.get(String(cid)).v || 0,
    minServerIdInConversation: (cid) => stmt.minServerIdConv.get(String(cid)).v || null,
    latestInConversation: (cid) => parseRow(stmt.latestInConv.get(String(cid))),
    /** Số tin của người khác có server_id > cursor (tính unread sau sync) */
    countIncomingAfter: (cid, myUserId, serverId) =>
      stmt.countAfterServerId.get(String(cid), myUserId, serverId || 0, MESSAGE_TYPE.SYSTEM).c,
    localPathsBySha: (sha) => stmt.pathBySha.all(sha).map((r) => r.local_path),
    fileMetaBySha: (sha) => {
      const row = stmt.fileBySha.get(sha);
      return row ? safeJsonParse(row.file, null) : null;
    },
    setLocalPath: (cmid, p) => stmt.setLocalPath.run(p, cmid).changes,
    setLocalPathBySha: (sha, p) => stmt.setLocalPathBySha.run(p, sha).changes,
    remapConversation: (oldId, newId) => stmt.remapConv.run(String(newId), String(oldId)).changes,
    deleteByConversation: (cid) => stmt.deleteConv.run(String(cid)).changes,
  };
}

module.exports = { createMessageRepo, computeSortKey, forwardStatus, parseRow, UNSYNCED_STATES };
