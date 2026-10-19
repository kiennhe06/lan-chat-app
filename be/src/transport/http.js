/**
 * HTTP routes (cùng cổng 5001 với WebSocket) — PROTOCOL §6.
 *
 *   GET  /health                      không auth
 *   POST /upload                      Bearer; body raw, header X-File-Name (encodeURIComponent), ≤ 200MB → 413
 *   GET  /download/:fileId            Bearer hoặc ?token=
 *   GET  /file/by-hash/:sha256        Bearer hoặc ?token=
 *   HEAD /file/by-hash/:sha256        Bearer
 *   GET  /thumb/:sha256               không auth (hash khó đoán)
 *   POST /avatar                      Bearer; body raw ảnh ≤ 10MB
 *   GET  /avatar/:name                không auth
 *   GET  /admin, /admin/api/*         trang nhật ký — CHỈ localhost của máy chủ (modules/log/adminLogRoutes.js)
 *
 * Mọi route kiểm tra IP bị chặn (403). Lỗi trả JSON { success:false, error:{ code, message } }.
 */
'use strict';

const fs = require('fs');
const { pipeline } = require('stream/promises');
const C = require('../shared/constants');
const { normalizeIp } = require('../core/utils/network');
const { errors, toWireError, isAppError } = require('../core/errors');
const { formatBytes } = require('../modules/file/fileService');
const { createAdminLogRoutes } = require('../modules/log/adminLogRoutes');
const { runWithRequestContext } = require('../core/requestContext');

const E = C.ERROR_CODE;
const STATUS_BY_CODE = Object.freeze({
  [E.VALIDATION]: 400,
  [E.UNAUTHORIZED]: 401,
  [E.INVALID_CREDENTIALS]: 401,
  [E.SESSION_EXPIRED]: 401,
  [E.FORBIDDEN]: 403,
  [E.BLOCKED]: 403,
  [E.NOT_FOUND]: 404,
  [E.CONFLICT]: 409,
  [E.DUPLICATE]: 409,
  [E.TOO_LARGE]: 413,
});
const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';
const CORS_HEADERS = Object.freeze({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-File-Name',
  'Access-Control-Max-Age': '600',
});

function sendJson(res, status, body, extraHeaders) {
  if (res.headersSent) return;
  const text = JSON.stringify(body);
  res.writeHead(status, {
    ...CORS_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
    ...(extraHeaders || {}),
  });
  res.end(text);
}

function sendError(res, err, extraHeaders) {
  const wire = toWireError(err);
  sendJson(res, STATUS_BY_CODE[wire.code] || 500, { success: false, error: wire }, extraHeaders);
}

/** Content-Disposition an toàn cho tên Unicode (RFC 6266 / 5987). */
function contentDisposition(name) {
  const ascii = String(name).replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/** Lấy token từ header Authorization: Bearer hoặc (nếu cho phép) query ?token=. */
function extractToken(req, url, allowQuery) {
  const header = req.headers.authorization || '';
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  if (match) return match[1];
  return allowQuery ? url.searchParams.get('token') : null;
}

/** Đọc toàn bộ body vào Buffer với giới hạn kích thước. */
function readBody(req, maxBytes, tooLargeMessage) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(errors.tooLarge(tooLargeMessage));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/**
 * Tạo request handler cho http.createServer.
 * @param {{ services: object, logger: object, config: object }} deps
 */
function createHttpHandler(deps) {
  const { services, logger, config } = deps;
  const CAT = C.LOG_CATEGORY.FILE;

  const authenticate = (req, url, allowQuery) => {
    const token = extractToken(req, url, allowQuery);
    if (!token) throw errors.unauthorized();
    return services.auth.authenticateToken(token).user;
  };

  /** Stream file ra response (GET) hoặc chỉ header (HEAD). */
  async function streamFile(req, res, filePath, headers) {
    const stat = await fs.promises.stat(filePath);
    res.writeHead(200, { ...CORS_HEADERS, 'Content-Length': stat.size, ...headers });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    await pipeline(fs.createReadStream(filePath), res);
  }

  const routes = [
    {
      method: 'GET',
      pattern: /^\/health$/,
      handle: (req, res) =>
        sendJson(res, 200, { app: C.APP_NAME, version: C.APP_VERSION, server_name: config.server.name, server_time: new Date().toISOString() }),
    },
    {
      method: 'POST',
      pattern: /^\/upload$/,
      handle: async (req, res, ctx) => {
        const user = authenticate(req, ctx.url, false);
        const length = Number(req.headers['content-length']);
        if (length > config.upload.maxFileSize) {
          // Từ chối sớm trước khi đọc body
          sendError(res, errors.tooLarge(`File vượt quá ${formatBytes(config.upload.maxFileSize)}`), { Connection: 'close' });
          return;
        }
        const file = await services.file.ingestUpload(req, {
          fileName: req.headers['x-file-name'],
          mimeType: req.headers['content-type'],
          contentLength: length,
          userId: user.id,
          ip: ctx.ip,
        });
        sendJson(res, 200, { success: true, file });
      },
    },
    {
      method: 'GET',
      pattern: /^\/download\/(\d{1,15})$/,
      handle: async (req, res, ctx) => {
        const user = authenticate(req, ctx.url, true);
        const { row, filePath } = services.file.getDownloadById(ctx.params[0]);
        logger.info(CAT, 'file_downloaded', { file_id: row.id, name: row.original_name, size: row.size }, { userId: user.id, ip: ctx.ip });
        await streamFile(req, res, filePath, { 'Content-Type': row.mime_type, 'Content-Disposition': contentDisposition(row.original_name) });
      },
    },
    {
      method: 'GET',
      pattern: /^\/file\/by-hash\/([a-f0-9]{64})$/,
      handle: async (req, res, ctx) => {
        authenticate(req, ctx.url, true);
        const { row, filePath } = services.file.getDownloadByHash(ctx.params[0]);
        await streamFile(req, res, filePath, {
          'Content-Type': row.mime_type,
          'Content-Disposition': contentDisposition(row.original_name),
          'Cache-Control': 'private, max-age=31536000, immutable',
        });
      },
    },
    {
      method: 'HEAD',
      pattern: /^\/file\/by-hash\/([a-f0-9]{64})$/,
      handle: async (req, res, ctx) => {
        authenticate(req, ctx.url, false);
        const { row, filePath } = services.file.getDownloadByHash(ctx.params[0]);
        await streamFile(req, res, filePath, { 'Content-Type': row.mime_type });
      },
    },
    {
      method: 'GET',
      pattern: /^\/thumb\/([a-f0-9]{64})$/,
      handle: async (req, res, ctx) => {
        const file = services.file.getThumbPath(ctx.params[0]);
        if (!file) throw errors.notFound('Không có thumbnail');
        await streamFile(req, res, file, { 'Content-Type': 'image/webp', 'Cache-Control': IMMUTABLE_CACHE });
      },
    },
    {
      method: 'POST',
      pattern: /^\/avatar$/,
      handle: async (req, res, ctx) => {
        const user = authenticate(req, ctx.url, false);
        const max = config.upload.maxAvatarSize;
        const tooLargeMessage = `Ảnh đại diện tối đa ${formatBytes(max)}`;
        if (Number(req.headers['content-length']) > max) {
          sendError(res, errors.tooLarge(tooLargeMessage), { Connection: 'close' });
          return;
        }
        const body = await readBody(req, max, tooLargeMessage);
        const result = await services.file.updateAvatar(user.id, body, ctx.ip);
        sendJson(res, 200, { success: true, user: result.user });
      },
    },
    {
      method: 'GET',
      pattern: /^\/avatar\/([A-Za-z0-9_.-]{1,120})$/,
      handle: async (req, res, ctx) => {
        const file = services.file.getAvatarPath(ctx.params[0]);
        if (!file) throw errors.notFound('Không có ảnh đại diện');
        await streamFile(req, res, file, { 'Content-Type': 'image/webp', 'Cache-Control': IMMUTABLE_CACHE });
      },
    },
  ];

  routes.push(...createAdminLogRoutes({ logAggregator: services.logAggregator, logger }));

  function matchRoute(method, pathname) {
    let pathMatched = false;
    for (const route of routes) {
      const m = route.pattern.exec(pathname);
      if (!m) continue;
      pathMatched = true;
      if (route.method === method) return { route, params: m.slice(1) };
    }
    return { route: null, pathMatched };
  }

  /** Request handler chính. */
  return async function handleRequest(req, res) {
    const ip = normalizeIp(req.socket.remoteAddress);
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch (_err) {
      sendError(res, errors.validation('URL không hợp lệ'));
      return;
    }
    try {
      if (services.admin.isBlocked(ip)) {
        logger.logAudit(C.LOG_LEVEL.AUDIT, C.LOG_CATEGORY.CONNECTION, 'blocked_ip_http_rejected', null, { path: url.pathname }, ip);
        sendError(res, errors.blocked(), { Connection: 'close' });
        return;
      }
      if (req.method === 'OPTIONS') {
        res.writeHead(204, CORS_HEADERS);
        res.end();
        return;
      }
      const { route, params, pathMatched } = matchRoute(req.method, url.pathname);
      if (!route) {
        sendJson(res, pathMatched ? 405 : 404, { success: false, error: { code: E.NOT_FOUND, message: 'Không tìm thấy đường dẫn' } });
        return;
      }
      await runWithRequestContext({ ip }, () => route.handle(req, res, { url, params, ip }));
    } catch (err) {
      if (!isAppError(err)) {
        // Không log query string (có thể chứa token)
        logger.error(C.LOG_CATEGORY.ERROR, 'http_handler_failed', { method: req.method, path: url.pathname, error: err }, { ip });
      } else if (err.code === E.TOO_LARGE) {
        logger.warn(CAT, 'upload_too_large', { path: url.pathname }, { ip });
      }
      if (res.headersSent) {
        res.destroy();
        return;
      }
      sendError(res, err, isAppError(err) && err.code === E.TOO_LARGE ? { Connection: 'close' } : undefined);
    }
  };
}

module.exports = { createHttpHandler, contentDisposition };
