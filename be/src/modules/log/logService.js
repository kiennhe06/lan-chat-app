/**
 * Log service của server.
 *
 * - Ghi JSONL: data/logs/server/YYYY-MM-DD.jsonl (ngày theo giờ local của máy server).
 *   Xoay vòng theo ngày + kích thước (mặc định 10MB): YYYY-MM-DD-1.jsonl, -2.jsonl, ...
 * - Retention: xóa file cũ hơn N ngày (khi khởi động + mỗi ngày).
 * - Level: debug < info < warn < error < audit. audit luôn được ghi.
 * - Dòng level audit/error đồng thời ghi vào bảng audit_log.
 * - Redact đệ quy các khóa nhạy cảm (password/token/secret/authorization).
 * - Nội dung tin nhắn KHÔNG log trừ khi logging.logMessageContent = true (khi đó chỉ content_preview ≤ 100 ký tự).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { currentRequestIp } = require('../../core/requestContext');
const C = require('../../shared/constants');
const { previewText } = require('../../shared/serializer');

const REDACTED = '[REDACTED]';
const MAX_REDACT_DEPTH = 8;
const FILE_RE = /^(\d{4}-\d{2}-\d{2})(?:-(\d+))?\.jsonl$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/** YYYY-MM-DD theo giờ local. */
function localDateKey(date) {
  const d = date || new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Ghi JSONL có xoay vòng theo ngày + dung lượng. Dùng chung cho log server và log client (logAggregator).
 */
class RotatingJsonlWriter {
  /**
   * @param {{ dir: string, rotateSizeBytes: number }} options
   */
  constructor(options) {
    this.dir = options.dir;
    this.rotateSizeBytes = options.rotateSizeBytes;
    this.dateKey = null;
    this.index = 0;
    this.size = 0;
  }

  fileName(dateKey, index) {
    return index > 0 ? `${dateKey}-${index}.jsonl` : `${dateKey}.jsonl`;
  }

  /** Lần đầu ghi trong ngày: tìm file có chỉ số lớn nhất của ngày đó để ghi tiếp. */
  openDay(dateKey) {
    fs.mkdirSync(this.dir, { recursive: true });
    let maxIndex = 0;
    for (const name of fs.readdirSync(this.dir)) {
      const m = FILE_RE.exec(name);
      if (m && m[1] === dateKey) maxIndex = Math.max(maxIndex, Number(m[2] || 0));
    }
    this.dateKey = dateKey;
    this.index = maxIndex;
    const file = path.join(this.dir, this.fileName(dateKey, maxIndex));
    this.size = fs.existsSync(file) ? fs.statSync(file).size : 0;
  }

  /**
   * Ghi 1 object thành 1 dòng JSON. Throw nếu lỗi I/O (caller quyết định xử lý).
   * @param {object} entry
   */
  write(entry) {
    const line = `${JSON.stringify(entry)}\n`;
    const bytes = Buffer.byteLength(line);
    const dateKey = localDateKey();
    if (dateKey !== this.dateKey) this.openDay(dateKey);
    if (this.size > 0 && this.size + bytes > this.rotateSizeBytes) {
      this.index += 1;
      this.size = 0;
    }
    fs.appendFileSync(path.join(this.dir, this.fileName(this.dateKey, this.index)), line, 'utf8');
    this.size += bytes;
  }

  /**
   * Danh sách file log (mới nhất trước).
   * @returns {string[]} đường dẫn tuyệt đối
   */
  listFilesNewestFirst() {
    if (!fs.existsSync(this.dir)) return [];
    return fs
      .readdirSync(this.dir)
      .map((name) => ({ name, m: FILE_RE.exec(name) }))
      .filter((x) => x.m)
      .sort((a, b) => (a.m[1] === b.m[1] ? Number(b.m[2] || 0) - Number(a.m[2] || 0) : a.m[1] < b.m[1] ? 1 : -1))
      .map((x) => path.join(this.dir, x.name));
  }

  /**
   * Xóa file log cũ hơn retentionDays.
   * @returns {number} số file đã xóa
   */
  cleanup(retentionDays) {
    if (!fs.existsSync(this.dir)) return 0;
    const cutoff = localDateKey(new Date(Date.now() - retentionDays * DAY_MS));
    let removed = 0;
    for (const name of fs.readdirSync(this.dir)) {
      const m = FILE_RE.exec(name);
      if (m && m[1] < cutoff) {
        fs.unlinkSync(path.join(this.dir, name));
        removed += 1;
      }
    }
    return removed;
  }
}

/**
 * Che các khóa nhạy cảm (đệ quy). Không mutate input.
 * @param {unknown} value
 * @param {string[]} redactKeys
 * @param {number} [depth]
 */
function redact(value, redactKeys, depth) {
  const level = depth || 0;
  if (value == null || typeof value !== 'object') return value;
  if (level > MAX_REDACT_DEPTH) return '[Truncated]';
  if (value instanceof Error) return serializeError(value);
  if (Array.isArray(value)) return value.map((v) => redact(v, redactKeys, level + 1));
  const out = {};
  for (const [key, v] of Object.entries(value)) {
    const lower = key.toLowerCase();
    out[key] = redactKeys.some((k) => lower.includes(k)) ? REDACTED : redact(v, redactKeys, level + 1);
  }
  return out;
}

/** Error → object JSON được (không kèm dữ liệu nhạy cảm). */
function serializeError(err) {
  if (!(err instanceof Error)) return err;
  return { name: err.name, message: err.message, code: err.code, stack: err.stack };
}

/**
 * Tạo log service.
 * @param {{ dir: string, config: object, auditRepo?: object }} options
 */
function createLogService(options) {
  const cfg = options.config;
  const writer = new RotatingJsonlWriter({ dir: options.dir, rotateSizeBytes: cfg.rotateSizeBytes });
  const redactKeys = (cfg.redactKeys || C.LOG_REDACT_KEYS).map((k) => k.toLowerCase());
  const minRank = C.LOG_LEVEL_RANK[cfg.level];
  const consoleRank = cfg.consoleLevel === 'none' ? Infinity : C.LOG_LEVEL_RANK[cfg.consoleLevel];
  let auditRepo = options.auditRepo || null;
  let cleanupTimer = null;

  /** Báo lỗi của chính hệ thống log ra stderr (không thể ghi log vào log). */
  const reportLoggerFailure = (what, err) => {
    process.stderr.write(`[logService] ${what}: ${err && err.message}\n`);
  };

  const echoToConsole = (entry) => {
    const rank = C.LOG_LEVEL_RANK[entry.level];
    if (entry.level === C.LOG_LEVEL.AUDIT || rank < consoleRank) return;
    const meta = entry.meta ? ` ${JSON.stringify(entry.meta)}` : '';
    process.stderr.write(`[${entry.ts}] ${entry.level.toUpperCase()} ${entry.category}.${entry.action}${meta}\n`);
  };

  const persistAudit = (entry) => {
    if (!auditRepo) return;
    if (entry.level !== C.LOG_LEVEL.AUDIT && entry.level !== C.LOG_LEVEL.ERROR) return;
    try {
      auditRepo.insert({
        ts: entry.ts,
        level: entry.level,
        category: entry.category,
        action: entry.action,
        user_id: entry.user_id,
        client_id: entry.client_id,
        ip: entry.ip || null,
        meta: entry.meta ? JSON.stringify(entry.meta) : null,
        source: entry.source,
      });
    } catch (err) {
      reportLoggerFailure('ghi audit_log thất bại', err);
    }
  };

  /**
   * Ghi 1 dòng log.
   * @param {string} level LOG_LEVEL.*
   * @param {string} category LOG_CATEGORY.*
   * @param {string} action tên hành động (vd: login_success)
   * @param {object} [meta]
   * @param {{ userId?: number|null, ip?: string|null }} [ctx]
   */
  function log(level, category, action, meta, ctx) {
    const rank = C.LOG_LEVEL_RANK[level];
    if (rank === undefined) return;
    if (level !== C.LOG_LEVEL.AUDIT && rank < minRank) return;
    const entry = {
      log_id: crypto.randomUUID(),
      ts: new Date().toISOString(),
      level,
      category,
      user_id: (ctx && ctx.userId) || null,
      client_id: 'server',
      action,
      source: 'server',
    };
    // IP: truyền trực tiếp, nếu không thì lấy từ request đang xử lý (core/requestContext)
    const ip = (ctx && ctx.ip) || currentRequestIp();
    if (ip) entry.ip = ip;
    if (meta && Object.keys(meta).length) entry.meta = redact(meta, redactKeys);
    try {
      writer.write(entry);
    } catch (err) {
      reportLoggerFailure('ghi file log thất bại', err);
    }
    persistAudit(entry);
    echoToConsole(entry);
  }

  /**
   * API chuẩn theo spec 2.6: logAudit(level, category, action, userId, meta, ip).
   */
  function logAudit(level, category, action, userId, meta, ip) {
    log(level, category, action, meta, { userId, ip });
  }

  /**
   * Meta cho nội dung tin nhắn: chỉ khi bật logMessageContent, tối đa 100 ký tự.
   * @param {string} content
   */
  function contentMeta(content) {
    if (!cfg.logMessageContent || !content) return {};
    return { content_preview: previewText(content, cfg.contentPreviewMax || C.LOG_CONTENT_PREVIEW_MAX) };
  }

  function runCleanup() {
    try {
      const removed = writer.cleanup(cfg.retentionDays);
      if (removed) log(C.LOG_LEVEL.INFO, C.LOG_CATEGORY.APP, 'log_retention_cleanup', { removed });
    } catch (err) {
      log(C.LOG_LEVEL.ERROR, C.LOG_CATEGORY.ERROR, 'log_retention_failed', { error: err });
    }
  }

  return {
    log,
    logAudit,
    debug: (category, action, meta, ctx) => log(C.LOG_LEVEL.DEBUG, category, action, meta, ctx),
    info: (category, action, meta, ctx) => log(C.LOG_LEVEL.INFO, category, action, meta, ctx),
    warn: (category, action, meta, ctx) => log(C.LOG_LEVEL.WARN, category, action, meta, ctx),
    error: (category, action, meta, ctx) => log(C.LOG_LEVEL.ERROR, category, action, meta, ctx),
    contentMeta,
    redact: (value) => redact(value, redactKeys),
    setAuditRepo: (repo) => {
      auditRepo = repo;
    },
    /** Dọn log cũ ngay + lặp lại mỗi ngày. */
    startRetention: () => {
      runCleanup();
      cleanupTimer = setInterval(runCleanup, cfg.cleanupIntervalMs);
      cleanupTimer.unref();
    },
    stop: () => {
      if (cleanupTimer) clearInterval(cleanupTimer);
      cleanupTimer = null;
    },
    writer,
  };
}

module.exports = { createLogService, RotatingJsonlWriter, redact, serializeError, localDateKey };
