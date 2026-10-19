/**
 * Cấu hình log mặc định của server.
 * - level: mức tối thiểu ghi ra file (audit luôn được ghi).
 * - consoleLevel: mức tối thiểu in ra console ('none' = tắt). Mặc định chỉ in lỗi.
 * - logMessageContent: false → KHÔNG ghi nội dung tin nhắn; true → meta.content_preview ≤ 100 ký tự.
 */
'use strict';

const C = require('../../shared/constants');

const loggingConfig = Object.freeze({
  level: C.LOG_LEVEL.INFO,
  consoleLevel: C.LOG_LEVEL.ERROR,
  retentionDays: 30,
  rotateSizeBytes: 10 * 1024 * 1024, // 10MB → -1.jsonl, -2.jsonl...
  cleanupIntervalMs: 24 * 60 * 60 * 1000,
  redactKeys: C.LOG_REDACT_KEYS,
  logMessageContent: false,
  contentPreviewMax: C.LOG_CONTENT_PREVIEW_MAX,
  clientLogDedupMax: 100000, // số log_id client giữ lại để chống ghi trùng
});

module.exports = loggingConfig;
