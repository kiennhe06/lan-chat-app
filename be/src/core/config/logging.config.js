/**
 * Cấu hình log mặc định của server.
 * - level: mức tối thiểu ghi ra file (audit luôn được ghi).
 * - consoleLevel: mức tối thiểu in ra console ('none' = tắt). Mặc định chỉ in lỗi.
 * - logMessageContent: true → ghi TOÀN BỘ nội dung tin nhắn khi gửi / sửa (kèm nội dung cũ) / thu hồi
 *   (thu hồi xóa nội dung khỏi DB, nhật ký là nơi duy nhất còn giữ). false → không ghi nội dung.
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
  logMessageContent: true,
  clientLogDedupMax: 100000, // số log_id client giữ lại để chống ghi trùng
});

module.exports = loggingConfig;
