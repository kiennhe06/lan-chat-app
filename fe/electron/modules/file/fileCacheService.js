/**
 * Phân giải ảnh/avatar cho custom protocol lcfile:// (PROTOCOL §12) — ưu tiên bản local, sau đó tải
 * từ server và lưu cache trên đĩa để lần sau xem được khi offline.
 *   thumb/<sha>  → cache/thumbs → server /thumb → (fallback) ảnh gốc local
 *   image/<sha>  → local_path / downloads / downloads-p2p / cache/images → server /file/by-hash
 *   avatar/<name>→ cache/avatars → server /avatar/<name>
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { fileExists, isSha256, sniffFileMime, mimeFromName } = require('../../core/utils/files');

const AVATAR_NAME_REGEX = /^[A-Za-z0-9._-]{1,200}$/;
const THUMB_MIME = 'image/webp';

/**
 * @param {{ paths: object, repos: object, files: import('./fileTransferService').FileTransferService }} deps
 */
function createFileCacheService(deps) {
  const { paths, repos, files } = deps;
  const inflight = new Map(); // key → Promise (tránh tải trùng khi nhiều <img> cùng lúc)

  const once = (key, fn) => {
    if (inflight.has(key)) return inflight.get(key);
    const p = fn().finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  };

  /** Tìm file cache có tên bắt đầu bằng sha (có/không phần mở rộng) */
  function findCached(dir, base) {
    try {
      const hit = fs.readdirSync(dir).find((n) => n === base || n.startsWith(`${base}.`));
      return hit ? path.join(dir, hit) : null;
    } catch (_err) {
      return null;
    }
  }

  function mimeFor(sha, filePath) {
    const meta = repos.messages.fileMetaBySha(sha);
    return (meta && meta.mime_type) || sniffFileMime(filePath) || mimeFromName(filePath);
  }

  /** @returns {Promise<{path: string, mime: string} | null>} */
  async function resolveImage(sha) {
    if (!isSha256(sha)) return null;
    const local = files.findLocalCopy(sha) || findCached(paths.CACHE_IMAGES, sha);
    if (local) return { path: local, mime: mimeFor(sha, local) };
    return once(`image:${sha}`, async () => {
      const dest = path.join(paths.CACHE_IMAGES, sha);
      const got = await files.fetchToCache(`/file/by-hash/${sha}`, dest, true);
      return got ? { path: got, mime: mimeFor(sha, got) } : null;
    });
  }

  async function resolveThumb(sha) {
    if (!isSha256(sha)) return null;
    const cached = findCached(paths.CACHE_THUMBS, sha);
    if (cached) return { path: cached, mime: THUMB_MIME };
    const fetched = await once(`thumb:${sha}`, () => files.fetchToCache(`/thumb/${sha}`, path.join(paths.CACHE_THUMBS, `${sha}.webp`), false));
    if (fetched) return { path: fetched, mime: THUMB_MIME };
    // Offline / server chưa có thumbnail → dùng ảnh gốc local nếu có
    const local = files.findLocalCopy(sha) || findCached(paths.CACHE_IMAGES, sha);
    return local ? { path: local, mime: mimeFor(sha, local) } : null;
  }

  async function resolveAvatar(name) {
    if (!AVATAR_NAME_REGEX.test(name) || name.startsWith('.')) return null;
    const cachedPath = path.join(paths.CACHE_AVATARS, name);
    if (fileExists(cachedPath)) return { path: cachedPath, mime: sniffFileMime(cachedPath) || mimeFromName(name) };
    const got = await once(`avatar:${name}`, () => files.fetchToCache(`/avatar/${encodeURIComponent(name)}`, cachedPath, false));
    return got ? { path: got, mime: sniffFileMime(got) || mimeFromName(name) } : null;
  }

  /**
   * @param {'thumb'|'image'|'avatar'} kind
   * @param {string} key sha256 hoặc tên avatar (đã decode)
   */
  function resolve(kind, key) {
    if (kind === 'thumb') return resolveThumb(key);
    if (kind === 'image') return resolveImage(key);
    if (kind === 'avatar') return resolveAvatar(key);
    return Promise.resolve(null);
  }

  return { resolve, resolveImage };
}

module.exports = { createFileCacheService };
