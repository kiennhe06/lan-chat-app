/**
 * Trang xem nhật ký hoạt động — CHỈ mở được trên chính máy chủ.
 *
 *   GET /admin                 trang HTML (adminPage/index.html)
 *   GET /admin/app.js          script của trang (tách file để CSP không cần 'unsafe-inline' cho script)
 *   GET /admin/api/info        cấu hình hiển thị (có ghi nội dung tin nhắn không)
 *   GET /admin/api/users       danh sách thành viên cho bộ lọc
 *   GET /admin/api/members     tab Quản lý thành viên: online, đăng nhập cuối, số tin/file/nhóm
 *   GET /admin/api/logs        truy vấn log (query string = bộ lọc)
 *   GET /admin/api/export      tải log đã lọc dạng .jsonl
 *
 * Bảo vệ (mọi route):
 *   1. IP kết nối phải là loopback (127.x / ::1) → máy khác trong LAN bị 403.
 *   2. Host header phải là localhost / 127.0.0.1 / [::1] → chặn DNS rebinding từ trang web lạ.
 *   3. Không gửi header CORS → trang web khác mở trên máy chủ cũng không đọc được dữ liệu.
 * Không cần đăng nhập: ai ngồi trước máy chủ đã có toàn quyền với thư mục data/ (log, DB).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const C = require('../../shared/constants');
const { isLoopback } = require('../../core/utils/network');

const PAGE_DIR = path.join(__dirname, 'adminPage');
const ALLOWED_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);
const SECURITY_HEADERS = Object.freeze({
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy':
    "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
});
const FILTER_KEYS = ['level', 'min_level', 'category', 'action', 'user_id', 'from', 'to', 'users_only', 'q', 'limit'];

/** Lấy hostname từ Host header (bỏ cổng, giữ nguyên dạng [::1]). */
function hostnameOf(hostHeader) {
  const host = String(hostHeader || '').trim().toLowerCase();
  if (host.startsWith('[')) return host.slice(0, host.indexOf(']') + 1);
  return host.split(':')[0];
}

/** Request có đến từ chính máy chủ qua địa chỉ localhost không. */
function isLocalRequest(ip, hostHeader) {
  return isLoopback(ip) && ALLOWED_HOSTNAMES.has(hostnameOf(hostHeader));
}

function send(res, status, contentType, body, extraHeaders) {
  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8');
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': contentType, 'Content-Length': buffer.length, ...(extraHeaders || {}) });
  res.end(buffer);
}

const sendJson = (res, status, data) => send(res, status, 'application/json; charset=utf-8', JSON.stringify(data));

/** Đọc bộ lọc từ query string (chỉ nhận các key đã biết). */
function readFilters(url) {
  const filters = {};
  for (const key of FILTER_KEYS) {
    const value = url.searchParams.get(key);
    if (value !== null && value !== '') filters[key] = value;
  }
  return filters;
}

/** Đọc file tĩnh của trang 1 lần lúc khởi động (thiếu file → lỗi rõ ràng ngay khi start). */
function loadStaticFiles() {
  return {
    html: fs.readFileSync(path.join(PAGE_DIR, 'index.html')),
    script: fs.readFileSync(path.join(PAGE_DIR, 'app.js')),
  };
}

/**
 * Tạo các route cho http.js (cùng shape { method, pattern, handle }).
 * @param {{ logAggregator: object, memberDirectory: object, logger: object, config: object }} deps
 */
function createAdminLogRoutes(deps) {
  const { logAggregator, memberDirectory, logger, config } = deps;
  const files = loadStaticFiles();

  /** Bọc handler: kiểm tra localhost trước, bắt lỗi để không lộ chi tiết. */
  const guarded = (handler) => async (req, res, ctx) => {
    if (!isLocalRequest(ctx.ip, req.headers.host)) {
      logger.logAudit(C.LOG_LEVEL.AUDIT, C.LOG_CATEGORY.SETTINGS, 'admin_page_denied', null, { path: ctx.url.pathname }, ctx.ip);
      send(res, 403, 'text/plain; charset=utf-8', 'Trang nhật ký chỉ mở được trên chính máy chủ: http://localhost:' + (req.socket.localPort || ''));
      return;
    }
    try {
      await handler(req, res, ctx);
    } catch (err) {
      logger.error(C.LOG_CATEGORY.ERROR, 'admin_page_failed', { path: ctx.url.pathname, error: err }, { ip: ctx.ip });
      if (!res.headersSent) sendJson(res, 500, { success: false, error: { code: C.ERROR_CODE.INTERNAL, message: 'Không đọc được nhật ký' } });
      else res.destroy();
    }
  };

  return [
    {
      method: 'GET',
      pattern: /^\/admin\/?$/,
      handle: guarded((req, res) => send(res, 200, 'text/html; charset=utf-8', files.html)),
    },
    {
      method: 'GET',
      pattern: /^\/admin\/app\.js$/,
      handle: guarded((req, res) => send(res, 200, 'text/javascript; charset=utf-8', files.script)),
    },
    {
      method: 'GET',
      pattern: /^\/admin\/api\/info$/,
      handle: guarded((req, res) => sendJson(res, 200, { success: true, log_message_content: Boolean(config.logging.logMessageContent) })),
    },
    {
      method: 'GET',
      pattern: /^\/admin\/api\/members$/,
      handle: guarded((req, res) => sendJson(res, 200, { success: true, members: memberDirectory.listMembers() })),
    },
    {
      method: 'GET',
      pattern: /^\/admin\/api\/users$/,
      handle: guarded((req, res) => sendJson(res, 200, { success: true, users: logAggregator.listUsers() })),
    },
    {
      method: 'GET',
      pattern: /^\/admin\/api\/logs$/,
      handle: guarded(async (req, res, ctx) => {
        const result = await logAggregator.query(readFilters(ctx.url));
        sendJson(res, 200, { success: true, ...result });
      }),
    },
    {
      method: 'GET',
      pattern: /^\/admin\/api\/export$/,
      handle: guarded(async (req, res, ctx) => {
        const filters = { ...readFilters(ctx.url), limit: C.LOG_QUERY_LIMIT };
        const { logs } = await logAggregator.query(filters);
        const body = logs.map((entry) => JSON.stringify(entry)).join('\n') + (logs.length ? '\n' : '');
        const fileName = `lanchat-nhat-ky-${new Date().toISOString().slice(0, 10)}.jsonl`;
        logger.logAudit(C.LOG_LEVEL.AUDIT, C.LOG_CATEGORY.SETTINGS, 'admin_logs_exported', null, { count: logs.length }, ctx.ip);
        send(res, 200, 'application/x-ndjson; charset=utf-8', body, { 'Content-Disposition': `attachment; filename="${fileName}"` });
      }),
    },
  ];
}

module.exports = { createAdminLogRoutes, isLocalRequest };
