/**
 * Gom log từ client (log:batch / log:event) và phục vụ truy vấn log cho trang admin trên máy chủ.
 *
 * - Log client ghi vào data/logs/clients/YYYY-MM-DD.jsonl (cùng cơ chế xoay vòng/retention với log server),
 *   mỗi dòng có source:"client" + ip do server thấy + user_id của socket (không tin user_id client tự khai).
 * - Chống ghi trùng theo log_id (bảng client_log_ids). Log level audit/error → thêm vào bảng audit_log.
 * - query() đọc JSONL của cả server lẫn client (mới nhất trước), lọc theo level/category/action/user/from/to/từ khóa,
 *   gắn tên người dùng / cuộc trò chuyện / file, giới hạn ≤ LOG_QUERY_LIMIT. Chỉ trang admin (localhost) gọi hàm này.
 */
'use strict';

const fsp = require('fs/promises');
const path = require('path');
const C = require('../../shared/constants');
const { errors } = require('../../core/errors');
const { RotatingJsonlWriter, redact } = require('./logService');

const LOG_ID_RE = /^[A-Za-z0-9_.:-]{1,100}$/;
const SHORT_TEXT_MAX = 100;
const DATE_PREFIX_RE = /^(\d{4}-\d{2}-\d{2})/;
const DAY_MS = 24 * 60 * 60 * 1000;

const shortText = (value, fallback) => {
  const s = typeof value === 'string' ? value.trim().slice(0, SHORT_TEXT_MAX) : '';
  return s || fallback;
};
const validTs = (value) => (typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : null);

/**
 * @param {{ repos: object, paths: object, config: object, logger: object, serverWriter: object }} deps
 */
function createLogAggregator(deps) {
  const { repos, paths, config, logger, serverWriter } = deps;
  const logCfg = config.logging;
  const redactKeys = (logCfg.redactKeys || C.LOG_REDACT_KEYS).map((k) => k.toLowerCase());
  const clientWriter = new RotatingJsonlWriter({ dir: paths.LOGS_CLIENTS, rotateSizeBytes: logCfg.rotateSizeBytes });
  const validLevels = Object.values(C.LOG_LEVEL);

  /** Chuẩn hóa 1 LogEntry từ client (không tin dữ liệu client). */
  function normalizeEntry(raw, user, ip, receivedAt) {
    const meta = raw.meta && typeof raw.meta === 'object' ? redact(raw.meta, redactKeys) : undefined;
    if (meta && !logCfg.logMessageContent) delete meta.content; // không lưu nội dung tin nhắn
    return {
      log_id: raw.log_id,
      ts: validTs(raw.ts) || receivedAt,
      level: validLevels.includes(raw.level) ? raw.level : C.LOG_LEVEL.INFO,
      category: shortText(raw.category, C.LOG_CATEGORY.APP),
      user_id: user.id,
      client_id: shortText(raw.client_id, null),
      action: shortText(raw.action, 'unknown'),
      ip,
      ...(meta ? { meta } : {}),
      source: 'client',
      received_at: receivedAt,
    };
  }

  /** Ghi 1 entry đã chuẩn hóa ra file + audit_log nếu cần. */
  function persist(entry) {
    clientWriter.write(entry);
    if (entry.level === C.LOG_LEVEL.AUDIT || entry.level === C.LOG_LEVEL.ERROR) {
      repos.auditLog.insert({
        ts: entry.ts,
        level: entry.level,
        category: entry.category,
        action: entry.action,
        user_id: entry.user_id,
        client_id: entry.client_id,
        ip: entry.ip,
        meta: entry.meta ? JSON.stringify(entry.meta) : null,
        source: 'client',
      });
    }
  }

  /**
   * Nhận danh sách log từ client.
   * @returns {{ ids: string[] }} log_id đã nhận (kể cả trùng) → client xóa khỏi hàng đợi
   */
  function ingest(user, ip, logs) {
    if (!Array.isArray(logs)) throw errors.validation('logs phải là mảng');
    if (logs.length > config.sync.maxLogBatch) throw errors.validation(`Tối đa ${config.sync.maxLogBatch} log mỗi lần`);
    const receivedAt = new Date().toISOString();
    const ids = [];
    for (const raw of logs) {
      if (!raw || typeof raw !== 'object' || typeof raw.log_id !== 'string' || !LOG_ID_RE.test(raw.log_id)) continue;
      try {
        if (repos.auditLog.markClientLog(raw.log_id, receivedAt)) persist(normalizeEntry(raw, user, ip, receivedAt));
        ids.push(raw.log_id);
      } catch (err) {
        // Không ack log này → client sẽ gửi lại lần sau
        logger.error(C.LOG_CATEGORY.ERROR, 'client_log_persist_failed', { log_id: raw.log_id, error: err }, { userId: user.id, ip });
      }
    }
    return { ids };
  }

  /** Dọn log client cũ + bảng chống trùng (gọi định kỳ cùng retention). */
  function cleanup() {
    try {
      clientWriter.cleanup(logCfg.retentionDays);
      repos.auditLog.pruneClientLogIds(new Date(Date.now() - logCfg.retentionDays * DAY_MS).toISOString());
    } catch (err) {
      logger.error(C.LOG_CATEGORY.ERROR, 'client_log_cleanup_failed', { error: err });
    }
  }

  function buildFilter(input) {
    const src = input || {};
    const level = validLevels.includes(src.level) ? src.level : null;
    const minRank = validLevels.includes(src.min_level) ? C.LOG_LEVEL_RANK[src.min_level] : null;
    const category = typeof src.category === 'string' && src.category ? src.category : null;
    const action = typeof src.action === 'string' && src.action ? src.action.toLowerCase() : null;
    const userId = Number(src.user_id) > 0 ? Number(src.user_id) : null;
    const from = validTs(src.from);
    const to = validTs(src.to);
    const usersOnly = src.users_only === true || src.users_only === 'true' || src.users_only === '1';
    return (e) =>
      // "Chỉ hoạt động thành viên": có user_id, hoặc thuộc nhóm auth (đăng nhập sai chưa gắn được user)
      (!usersOnly || Boolean(e.user_id) || e.category === C.LOG_CATEGORY.AUTH) &&
      (!level || e.level === level) &&
      (minRank === null || (C.LOG_LEVEL_RANK[e.level] || 0) >= minRank) &&
      (!category || e.category === category) &&
      (!action || String(e.action || '').toLowerCase().includes(action)) &&
      (!userId || e.user_id === userId) &&
      (!from || e.ts >= from) &&
      (!to || e.ts <= to);
  }

  /** Gộp file server + client, nhóm theo ngày (mới nhất trước). */
  function filesByDay() {
    const all = [...serverWriter.listFilesNewestFirst(), ...clientWriter.listFilesNewestFirst()];
    const groups = new Map();
    for (const file of all) {
      const m = DATE_PREFIX_RE.exec(path.basename(file));
      if (!m) continue;
      if (!groups.has(m[1])) groups.set(m[1], []);
      groups.get(m[1]).push(file);
    }
    return Array.from(groups.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }

  async function readEntries(file, filter, out) {
    let text;
    try {
      text = await fsp.readFile(file, 'utf8');
    } catch (err) {
      if (err.code !== 'ENOENT') logger.warn(C.LOG_CATEGORY.ERROR, 'log_query_read_failed', { file, error: err.message });
      return;
    }
    for (const line of text.split('\n')) {
      if (!line) continue;
      try {
        const entry = JSON.parse(line);
        if (filter(entry)) out.push(entry);
      } catch (_err) {
        // Dòng hỏng (ghi dở khi mất điện) → bỏ qua dòng đó
      }
    }
  }

  /**
   * Gắn thông tin dễ đọc cho 1 entry: tên người dùng, tên cuộc trò chuyện, tên file.
   * Dùng cache theo từng lần truy vấn để không query DB lặp lại.
   */
  function createEnricher() {
    const users = new Map(repos.users.listAll().map((u) => [u.id, u]));
    const convLabels = new Map();
    const fileNames = new Map();
    const userName = (id) => (users.get(Number(id)) ? users.get(Number(id)).display_name : `#${id}`);

    function conversationLabel(convId) {
      if (!convId) return null;
      if (convLabels.has(convId)) return convLabels.get(convId);
      let label = null;
      try {
        const conv = repos.conversations.findById(Number(convId));
        if (conv && conv.type === C.CONVERSATION_TYPE.GROUP) label = `Nhóm "${conv.name}"`;
        else if (conv) label = `Chat 1-1: ${repos.conversations.listMembers(conv.id).map((m) => userName(m.user_id)).join(' ↔ ')}`;
        else label = `Cuộc trò chuyện #${convId} (đã xóa)`;
      } catch (err) {
        logger.warn(C.LOG_CATEGORY.ERROR, 'log_enrich_failed', { conversation_id: convId, error: err.message });
      }
      convLabels.set(convId, label);
      return label;
    }

    function fileName(fileId) {
      if (!fileId) return null;
      if (!fileNames.has(fileId)) {
        const row = repos.files.findById(Number(fileId));
        fileNames.set(fileId, row ? row.original_name : null);
      }
      return fileNames.get(fileId);
    }

    /** Tên những người bị tác động (thêm/xóa thành viên, đổi phó nhóm...). */
    function targetNames(meta) {
      const ids = [...(Array.isArray(meta.user_ids) ? meta.user_ids : []), meta.user_id, meta.target_user_id].filter((id) => Number(id) > 0);
      return ids.length ? ids.map(userName).join(', ') : null;
    }

    return (e) => {
      const u = users.get(e.user_id);
      const meta = e.meta || {};
      return {
        ...e,
        username: u ? u.username : null,
        display_name: u ? u.display_name : null,
        employee_id: u ? u.employee_id : null,
        conversation_label: conversationLabel(meta.conversation_id),
        target_names: targetNames(meta),
        file_name: meta.name || fileName(meta.file_id),
      };
    };
  }

  /** Tìm từ khóa (không phân biệt hoa thường) trên các trường hiển thị + meta. */
  function matchesKeyword(entry, keyword) {
    if (!keyword) return true;
    const haystack = [entry.action, entry.category, entry.ip, entry.username, entry.display_name, entry.employee_id,
      entry.conversation_label, entry.file_name, entry.target_names, entry.meta ? JSON.stringify(entry.meta) : '']
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(keyword);
  }

  /**
   * Truy vấn log server + client (mới nhất trước). CHỈ gọi từ trang admin trên máy chủ (localhost).
   * @param {{ level?, category?, action?, user_id?, from?, to?, users_only?, q?, limit? }} input
   * @returns {Promise<{ logs: object[], truncated: boolean }>}
   */
  async function query(input) {
    const src = input || {};
    const limit = Math.min(Math.max(Number(src.limit) || C.LOG_QUERY_LIMIT, 1), C.LOG_QUERY_LIMIT);
    const keyword = typeof src.q === 'string' ? src.q.trim().toLowerCase() : '';
    const filter = buildFilter(src);
    const enrich = createEnricher();
    const matched = [];
    for (const [, files] of filesByDay()) {
      const dayEntries = [];
      for (const file of files) await readEntries(file, filter, dayEntries);
      for (const entry of dayEntries) {
        const enriched = enrich(entry);
        if (matchesKeyword(enriched, keyword)) matched.push(enriched);
      }
      if (matched.length > limit) break; // đủ số dòng của các ngày mới nhất
    }
    matched.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
    return { logs: matched.slice(0, limit), truncated: matched.length > limit };
  }

  /** Danh sách thành viên cho bộ lọc trên trang admin. */
  function listUsers() {
    return repos.users.listAll().map((u) => ({ id: u.id, username: u.username, employee_id: u.employee_id, display_name: u.display_name, role: u.role }));
  }

  return { ingest, query, listUsers, cleanup };
}

module.exports = { createLogAggregator };
