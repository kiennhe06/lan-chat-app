/**
 * Log client: ghi JSONL local data/logs/clients/YYYY-MM-DD.jsonl (xoay vòng theo ngày + 10MB → -1, -2...,
 * giữ 30 ngày), redact dữ liệu nhạy cảm, gửi lô lên server (log:batch) khi online; audit gửi ngay (log:event).
 *
 * Không import Electron. Không bao giờ throw ra ngoài — lỗi ghi log chỉ in console (không thể tự log chính nó).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  LOG_LEVEL,
  LOG_LEVEL_RANK,
  LOG_CATEGORY,
  LOG_REDACT_KEYS,
  LOG_CONTENT_PREVIEW_MAX,
  LOG_BATCH_SIZE,
  LOG_FLUSH_INTERVAL_MS,
} = require('../../../shared/constants');
const { LOG } = require('../../../shared/wsEvents');

const REDACTED = '[REDACTED]';
const MAX_PENDING = 2000;
const MAX_DEPTH = 6;
const DAY_MS = 24 * 60 * 60 * 1000;
const LOG_FILE_REGEX = /^(\d{4}-\d{2}-\d{2})(?:-(\d+))?\.jsonl$/;

/**
 * Che các key nhạy cảm (so khớp substring, không phân biệt hoa thường) + xử lý nội dung tin nhắn.
 * @param {unknown} value
 * @param {{ logMessageContent?: boolean }} [opts]
 * @returns {unknown} bản sao đã redact
 */
function redact(value, opts, depth = 0) {
  if (value == null || typeof value !== 'object') return value;
  if (depth > MAX_DEPTH) return '[…]';
  if (Array.isArray(value)) return value.map((v) => redact(v, opts, depth + 1));
  if (value instanceof Error) return { name: value.name, message: value.message, code: value.code };
  const out = {};
  for (const [key, v] of Object.entries(value)) {
    const lower = key.toLowerCase();
    if (LOG_REDACT_KEYS.some((k) => lower.includes(k))) {
      out[key] = REDACTED;
    } else if (lower === 'content') {
      // Nội dung tin nhắn: mặc định KHÔNG log; bật cấu hình → chỉ preview tối đa 100 ký tự
      if (opts && opts.logMessageContent && typeof v === 'string') {
        out.content_preview = v.slice(0, LOG_CONTENT_PREVIEW_MAX);
      }
    } else {
      out[key] = redact(v, opts, depth + 1);
    }
  }
  return out;
}

/** "YYYY-MM-DD" theo giờ local */
function dateStamp(date) {
  const d = date || new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Tên file log: index 0 → YYYY-MM-DD.jsonl, n → YYYY-MM-DD-n.jsonl */
const logFileName = (stamp, index) => (index ? `${stamp}-${index}.jsonl` : `${stamp}.jsonl`);

/**
 * Chọn file log để ghi: file đầu tiên trong ngày còn chỗ cho `incomingBytes` (file rỗng luôn nhận).
 * @returns {{ filePath: string, index: number, size: number }}
 */
function resolveLogFile(dir, stamp, maxBytes, fsImpl, incomingBytes) {
  const fsx = fsImpl || fs;
  const need = incomingBytes || 0;
  for (let index = 0; ; index += 1) {
    const filePath = path.join(dir, logFileName(stamp, index));
    let size = 0;
    try {
      size = fsx.statSync(filePath).size;
    } catch (_err) {
      return { filePath, index, size: 0 };
    }
    if (size === 0 || size + need <= maxBytes) return { filePath, index, size };
  }
}

/**
 * @param {{
 *   dir: string, level?: string, clientId: string, maxFileBytes?: number, retentionDays?: number,
 *   logMessageContent?: boolean, shipEnabled?: boolean, consoleEcho?: boolean,
 *   getUserId?: () => number|null, fsImpl?: typeof fs, now?: () => Date
 * }} opts
 */
function createLogService(opts) {
  const fsx = opts.fsImpl || fs;
  const now = opts.now || (() => new Date());
  const minRank = LOG_LEVEL_RANK[opts.level] ?? LOG_LEVEL_RANK.info;
  const maxBytes = opts.maxFileBytes || 10 * 1024 * 1024;
  const retentionDays = opts.retentionDays || 30;
  const shipEnabled = opts.shipEnabled !== false;
  let clientId = opts.clientId || null;
  let current = null; // { stamp, filePath, index, size }
  let pending = []; // entry chờ gửi server
  let transport = null; // { isOnline, request, send }
  let flushTimer = null;
  let flushing = false;

  try {
    fsx.mkdirSync(opts.dir, { recursive: true });
  } catch (err) {
    console.error('[log] không tạo được thư mục log:', err.message);
  }

  function writeLine(entry) {
    const stamp = dateStamp(now());
    const line = `${JSON.stringify(entry)}\n`;
    const bytes = Buffer.byteLength(line);
    if (!current || current.stamp !== stamp || current.size + bytes > maxBytes) {
      current = { stamp, ...resolveLogFile(opts.dir, stamp, maxBytes, fsx, bytes) };
    }
    fsx.appendFileSync(current.filePath, line, 'utf8');
    current.size += bytes;
  }

  /**
   * Ghi 1 log.
   * @param {string} level
   * @param {string} category
   * @param {string} action
   * @param {object} [meta]
   * @returns {object|null} entry đã ghi
   */
  function log(level, category, action, meta) {
    try {
      const rank = LOG_LEVEL_RANK[level];
      if (rank === undefined || rank < minRank) return null;
      const entry = {
        log_id: crypto.randomUUID(),
        ts: now().toISOString(),
        level,
        category: category || LOG_CATEGORY.APP,
        user_id: opts.getUserId ? opts.getUserId() : null,
        client_id: clientId,
        action: String(action || ''),
      };
      if (meta !== undefined) entry.meta = redact(meta, { logMessageContent: opts.logMessageContent });
      writeLine(entry);
      if (opts.consoleEcho) console.log(`[${level}] ${entry.category}/${entry.action}`, entry.meta || '');
      if (shipEnabled && rank >= LOG_LEVEL_RANK.info) enqueue(entry);
      return entry;
    } catch (err) {
      console.error('[log] ghi log thất bại:', err.message);
      return null;
    }
  }

  function enqueue(entry) {
    pending.push(entry);
    if (pending.length > MAX_PENDING) pending = pending.slice(pending.length - MAX_PENDING);
    if (entry.level === LOG_LEVEL.AUDIT) shipAudit(entry);
  }

  /** Audit gửi ngay; lỗi → để lại trong pending cho lần batch sau */
  function shipAudit(entry) {
    if (!transport || !transport.isOnline()) return;
    transport
      .request(LOG.EVENT, { log: entry })
      .then(() => {
        pending = pending.filter((e) => e.log_id !== entry.log_id);
      })
      .catch((err) => console.warn('[log] gửi audit thất bại, sẽ thử lại:', err.message));
  }

  /**
   * Gửi các log đang chờ theo lô LOG_BATCH_SIZE (log:batch → log:ack {ids}).
   * @returns {Promise<number>} số log đã được server xác nhận
   */
  async function flush() {
    if (flushing || !transport || !transport.isOnline() || !pending.length) return 0;
    flushing = true;
    let acked = 0;
    try {
      while (pending.length && transport.isOnline()) {
        const batch = pending.slice(0, LOG_BATCH_SIZE);
        const res = await transport.request(LOG.BATCH, { logs: batch });
        const ids = new Set((res && res.ids) || batch.map((e) => e.log_id));
        pending = pending.filter((e) => !ids.has(e.log_id));
        acked += ids.size;
        if (!res || !Array.isArray(res.ids) || res.ids.length === 0) break; // tránh vòng lặp vô hạn
      }
    } catch (err) {
      console.warn('[log] gửi log:batch thất bại, sẽ thử lại:', err.message);
    } finally {
      flushing = false;
    }
    return acked;
  }

  /**
   * Gắn kênh gửi lên server.
   * @param {{ isOnline: () => boolean, request: (type: string, data: object) => Promise<any> }} t
   */
  function attachTransport(t) {
    transport = t;
    if (!flushTimer) {
      flushTimer = setInterval(() => flush(), LOG_FLUSH_INTERVAL_MS);
      if (flushTimer.unref) flushTimer.unref();
    }
  }

  /** Xóa file log quá hạn giữ (retention) */
  function cleanupOld() {
    let removed = 0;
    try {
      const cutoff = now().getTime() - retentionDays * DAY_MS;
      for (const name of fsx.readdirSync(opts.dir)) {
        const m = LOG_FILE_REGEX.exec(name);
        if (!m) continue;
        const fileDate = new Date(`${m[1]}T00:00:00`);
        if (fileDate.getTime() < cutoff) {
          fsx.unlinkSync(path.join(opts.dir, name));
          removed += 1;
        }
      }
    } catch (err) {
      console.error('[log] dọn log cũ thất bại:', err.message);
    }
    return removed;
  }

  function stop() {
    if (flushTimer) clearInterval(flushTimer);
    flushTimer = null;
  }

  const api = {
    log,
    debug: (c, a, m) => log(LOG_LEVEL.DEBUG, c, a, m),
    info: (c, a, m) => log(LOG_LEVEL.INFO, c, a, m),
    warn: (c, a, m) => log(LOG_LEVEL.WARN, c, a, m),
    error: (c, a, m) => log(LOG_LEVEL.ERROR, c, a, m),
    audit: (c, a, m) => log(LOG_LEVEL.AUDIT, c, a, m),
    attachTransport,
    flush,
    cleanupOld,
    stop,
    pendingCount: () => pending.length,
    /** Gán client_id (instance_id) sau khi DB sẵn sàng */
    setClientId: (id) => {
      clientId = id;
    },
    dir: opts.dir,
  };
  return api;
}

/** Logger rỗng (cho test / trước khi logService sẵn sàng) */
const NOOP_LOGGER = Object.freeze({
  log: () => null,
  debug: () => null,
  info: () => null,
  warn: () => null,
  error: () => null,
  audit: () => null,
});

module.exports = { createLogService, redact, dateStamp, logFileName, resolveLogFile, NOOP_LOGGER, REDACTED };
