/**
 * Custom protocol lcfile:// phục vụ ảnh/avatar từ cache local (xem được khi offline).
 * Phải gọi registerScheme() TRƯỚC app 'ready'; install() sau 'ready'.
 */
'use strict';

const fs = require('fs');
const { Readable } = require('stream');
const { protocol } = require('electron');
const { FILE_PROTOCOL } = require('../../ipc/channels');

/** Đăng ký scheme đặc quyền (standard + secure + fetch) — gọi trước ready */
function registerScheme() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: FILE_PROTOCOL,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: false },
    },
  ]);
}

const notFound = () => new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain' } });

/**
 * Gắn handler.
 * @param {{ resolve: (kind: string, key: string) => Promise<{path: string, mime: string}|null> }} cache
 * @param {object} logger
 */
function install(cache, logger) {
  protocol.handle(FILE_PROTOCOL, async (request) => {
    try {
      const url = new URL(request.url);
      const kind = url.hostname; // thumb | image | avatar
      const key = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
      const hit = await cache.resolve(kind, key);
      if (!hit) return notFound();
      const stat = await fs.promises.stat(hit.path);
      const body = Readable.toWeb(fs.createReadStream(hit.path));
      return new Response(body, {
        status: 200,
        headers: {
          'Content-Type': hit.mime || 'application/octet-stream',
          'Content-Length': String(stat.size),
          'Cache-Control': 'private, max-age=86400',
        },
      });
    } catch (err) {
      logger.warn('file', 'lcfile_failed', { url: request.url, message: err.message });
      return notFound();
    }
  });
}

module.exports = { registerScheme, install };
