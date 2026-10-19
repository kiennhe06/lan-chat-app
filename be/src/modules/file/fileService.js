/**
 * Nghiệp vụ file: nhận upload dạng stream (tính SHA-256 trong lúc ghi), dedup theo hash, thumbnail webp,
 * avatar 256×256, tra cứu file để download.
 *
 * Lưu trữ trên đĩa (KHÔNG blob trong SQLite):
 *   data/attachments/<sha256>        file gốc (tên trên đĩa = hash → chống path traversal)
 *   data/thumbnails/<sha256>.webp    thumbnail ≤ 400px
 *   data/avatars/u<id>-<hash8>.webp  avatar
 *   data/tmp/<uuid>.part             file tạm khi đang upload
 */
'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { Transform } = require('stream');
const { pipeline } = require('stream/promises');
const sharp = require('sharp');
const C = require('../../shared/constants');
const V = require('../../shared/validators');
const { toWireFile } = require('../../shared/serializer');
const { errors, isAppError } = require('../../core/errors');

// Không giữ cache/handle file trong sharp (Windows không xóa/đổi tên được file đang mở)
sharp.cache(false);

const SHA256_RE = /^[a-f0-9]{64}$/;
const AVATAR_NAME_RE = /^u\d+-[a-f0-9]{8,64}\.webp$/;
const MIME_RE = /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/;
const DEFAULT_MIME = 'application/octet-stream';
const THUMB_EXT = '.webp';
const AVATAR_WEBP_QUALITY = 85;
const THUMB_WEBP_QUALITY = 80;
// EXIF orientation 5–8 = ảnh xoay 90° → hoán đổi width/height
const ROTATED_ORIENTATIONS = new Set([5, 6, 7, 8]);

/** Đoán MIME theo đuôi file khi client không gửi Content-Type cụ thể. */
const EXT_MIME = Object.freeze({
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.zip': 'application/zip',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg',
});

/**
 * Chuẩn hóa MIME: bỏ tham số (;charset=...), chữ thường; không hợp lệ/octet-stream → đoán theo đuôi.
 * @param {string|undefined} raw
 * @param {string} fileName
 */
function normalizeMime(raw, fileName) {
  const value = String(raw || '').split(';')[0].trim().toLowerCase();
  if (MIME_RE.test(value) && value !== DEFAULT_MIME) return value;
  return EXT_MIME[path.extname(fileName).toLowerCase()] || DEFAULT_MIME;
}

/** Giải mã header X-File-Name (encodeURIComponent) + sanitize. */
function decodeFileName(raw) {
  let name = String(raw || '');
  try {
    name = decodeURIComponent(name);
  } catch (_err) {
    // Header không phải chuỗi đã encode → dùng nguyên bản, sanitize bên dưới vẫn đảm bảo an toàn
  }
  return V.sanitizeFileName(name);
}

/** Hiển thị dung lượng ngắn gọn cho thông báo lỗi. */
const formatBytes = (bytes) =>
  bytes >= 1024 * 1024 ? `${Math.round(bytes / 1024 / 1024)}MB` : `${Math.max(1, Math.round(bytes / 1024))}KB`;

const isSha256 = (value) => typeof value === 'string' && SHA256_RE.test(value);
const isAvatarName = (value) => typeof value === 'string' && AVATAR_NAME_RE.test(value);

/** Xóa file, bỏ qua nếu không tồn tại; lỗi khác → ném lên. */
async function removeIfExists(file) {
  try {
    await fsp.unlink(file);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

/**
 * Transform đếm byte + hash; vượt giới hạn → lỗi TOO_LARGE.
 */
function createHashingCounter(maxBytes, state) {
  return new Transform({
    transform(chunk, _enc, callback) {
      state.size += chunk.length;
      if (state.size > maxBytes) {
        callback(errors.tooLarge(`File vượt quá ${formatBytes(maxBytes)}`));
        return;
      }
      state.hash.update(chunk);
      callback(null, chunk);
    },
  });
}

/**
 * @param {{ repos: object, paths: object, config: object, logger: object, authService: object }} deps
 */
function createFileService(deps) {
  const { repos, paths, config, logger, authService } = deps;
  const CAT = C.LOG_CATEGORY.FILE;

  const attachmentPath = (sha) => path.join(paths.ATTACHMENTS, sha);
  const thumbPath = (sha) => path.join(paths.THUMBNAILS, `${sha}${THUMB_EXT}`);
  const avatarPath = (name) => path.join(paths.AVATARS, name);

  /**
   * Đọc kích thước + tạo thumbnail cho ảnh. Lỗi (ảnh hỏng) → không thumbnail, không chặn upload.
   * @returns {Promise<{ has_thumb: number, width: number|null, height: number|null }>}
   */
  async function processImage(sha, mime) {
    const result = { has_thumb: 0, width: null, height: null };
    if (!C.THUMBNAILABLE_MIME.includes(mime)) return result;
    const source = attachmentPath(sha);
    try {
      const meta = await sharp(source).metadata();
      const rotated = ROTATED_ORIENTATIONS.has(meta.orientation);
      result.width = (rotated ? meta.height : meta.width) || null;
      result.height = (rotated ? meta.width : meta.height) || null;
      if (!fs.existsSync(thumbPath(sha))) {
        await sharp(source)
          .rotate()
          .resize({ width: C.THUMB_MAX_PX, height: C.THUMB_MAX_PX, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: THUMB_WEBP_QUALITY })
          .toFile(thumbPath(sha));
      }
      result.has_thumb = 1;
    } catch (err) {
      logger.warn(CAT, 'thumbnail_failed', { sha256: sha, mime, error: err.message });
    }
    return result;
  }

  /**
   * Tạo row files cho blob đã có trên đĩa (dedup). Cùng hash + cùng tên → dùng lại row cũ.
   */
  async function registerBlob(sha, info) {
    const sameName = repos.files.findByShaAndName(sha, info.name);
    if (sameName) return sameName;
    const known = repos.files.findBySha(sha);
    const media = known
      ? { has_thumb: known.has_thumb, width: known.width, height: known.height }
      : await processImage(sha, info.mime);
    const id = repos.files.insert({
      sha256: sha,
      original_name: info.name,
      size: info.size,
      mime_type: info.mime,
      has_thumb: media.has_thumb,
      width: media.width,
      height: media.height,
      uploaded_by: info.userId || null,
      created_at: new Date().toISOString(),
    });
    return repos.files.findById(id);
  }

  /**
   * Nhận upload dạng stream.
   * @param {import('stream').Readable} source body request
   * @param {{ fileName?: string, mimeType?: string, contentLength?: number, userId: number, ip?: string }} meta
   * @returns {Promise<object>} WireFile
   */
  async function ingestUpload(source, meta) {
    const maxBytes = config.upload.maxFileSize;
    if (Number(meta.contentLength) > maxBytes) throw errors.tooLarge(`File vượt quá ${formatBytes(maxBytes)}`);
    const name = decodeFileName(meta.fileName);
    const mime = normalizeMime(meta.mimeType, name);
    const tmpFile = path.join(paths.TMP, `${crypto.randomUUID()}.part`);
    const state = { size: 0, hash: crypto.createHash('sha256') };
    try {
      await pipeline(source, createHashingCounter(maxBytes, state), fs.createWriteStream(tmpFile));
      if (state.size === 0) throw errors.validation('File rỗng');
      const sha = state.hash.digest('hex');
      if (fs.existsSync(attachmentPath(sha))) {
        await removeIfExists(tmpFile); // dedup: nội dung đã có trên server
      } else {
        await fsp.rename(tmpFile, attachmentPath(sha));
      }
      const row = await registerBlob(sha, { name, mime, size: state.size, userId: meta.userId });
      logger.logAudit(C.LOG_LEVEL.AUDIT, CAT, 'file_uploaded', meta.userId, { file_id: row.id, sha256: sha, size: state.size, mime, name }, meta.ip);
      return toWireFile(row);
    } catch (err) {
      await removeIfExists(tmpFile).catch((cleanupErr) =>
        logger.error(CAT, 'tmp_cleanup_failed', { file: tmpFile, error: cleanupErr.message })
      );
      if (!isAppError(err)) logger.error(CAT, 'upload_failed', { error: err, name }, { userId: meta.userId, ip: meta.ip });
      throw err;
    }
  }

  /** Row + đường dẫn file gốc theo id (để stream download). */
  function getDownloadById(fileId) {
    const id = Number(fileId);
    if (!Number.isSafeInteger(id) || id <= 0) throw errors.validation('file_id không hợp lệ');
    const row = repos.files.findById(id);
    if (!row || !fs.existsSync(attachmentPath(row.sha256))) throw errors.notFound('File không tồn tại');
    return { row, filePath: attachmentPath(row.sha256) };
  }

  /** Row + đường dẫn theo hash. */
  function getDownloadByHash(sha) {
    if (!isSha256(sha)) throw errors.validation('sha256 không hợp lệ');
    const row = repos.files.findBySha(sha);
    if (!row || !fs.existsSync(attachmentPath(sha))) throw errors.notFound('File không tồn tại');
    return { row, filePath: attachmentPath(sha) };
  }

  /** Đường dẫn thumbnail (null nếu không có). */
  function getThumbPath(sha) {
    if (!isSha256(sha)) throw errors.validation('sha256 không hợp lệ');
    const file = thumbPath(sha);
    return fs.existsSync(file) ? file : null;
  }

  /** Đường dẫn avatar (null nếu không có). */
  function getAvatarPath(name) {
    if (!isAvatarName(name)) throw errors.validation('Tên avatar không hợp lệ');
    const file = avatarPath(name);
    return fs.existsSync(file) ? file : null;
  }

  /**
   * sync:file-batch — phân loại file client có: server đã có (existing, kèm WireFile) / thiếu (missing).
   * @param {number} userId
   * @param {{ sha256: string, size?: number, name?: string, mime_type?: string }[]} files
   */
  async function checkBatch(userId, files) {
    const missing = [];
    const existing = [];
    for (const item of files) {
      const sha = item && item.sha256;
      if (!isSha256(sha)) continue;
      const known = fs.existsSync(attachmentPath(sha)) ? repos.files.findBySha(sha) : null;
      if (!known) {
        if (!missing.includes(sha)) missing.push(sha);
        continue;
      }
      const name = V.sanitizeFileName(item.name || known.original_name);
      const row = await registerBlob(sha, { name, mime: known.mime_type, size: known.size, userId });
      existing.push({ sha256: sha, file: toWireFile(row) });
    }
    return { missing, existing };
  }

  /**
   * Avatar: resize 256×256 cover webp, lưu file mới, cập nhật user (broadcast user:updated), xóa file cũ.
   * @param {number} userId
   * @param {Buffer} buffer ảnh gốc ≤ MAX_AVATAR_SIZE
   */
  async function updateAvatar(userId, buffer, ip) {
    if (!buffer || !buffer.length) throw errors.validation('Ảnh rỗng');
    if (buffer.length > config.upload.maxAvatarSize) throw errors.tooLarge(`Ảnh đại diện tối đa ${formatBytes(config.upload.maxAvatarSize)}`);
    let output;
    try {
      output = await sharp(buffer)
        .rotate()
        .resize(C.AVATAR_SIZE_PX, C.AVATAR_SIZE_PX, { fit: 'cover' })
        .webp({ quality: AVATAR_WEBP_QUALITY })
        .toBuffer();
    } catch (err) {
      logger.warn(CAT, 'avatar_decode_failed', { error: err.message }, { userId, ip });
      throw errors.validation('File không phải ảnh hợp lệ');
    }
    const hash = crypto.createHash('sha256').update(output).digest('hex').slice(0, 16);
    const name = `u${userId}-${hash}${THUMB_EXT}`;
    await fsp.writeFile(avatarPath(name), output);
    const { user, previousAvatar } = authService.setAvatar(userId, name, ip);
    if (previousAvatar && previousAvatar !== name && isAvatarName(previousAvatar)) {
      await removeIfExists(avatarPath(previousAvatar)).catch((err) =>
        logger.warn(CAT, 'old_avatar_cleanup_failed', { avatar: previousAvatar, error: err.message })
      );
    }
    return { user };
  }

  /** Dọn file tạm sót lại (server tắt đột ngột khi đang upload). */
  async function cleanupTmp() {
    let removed = 0;
    for (const name of await fsp.readdir(paths.TMP)) {
      if (!name.endsWith('.part')) continue;
      await removeIfExists(path.join(paths.TMP, name));
      removed += 1;
    }
    if (removed) logger.info(CAT, 'tmp_cleanup', { removed });
  }

  return {
    ingestUpload,
    getDownloadById,
    getDownloadByHash,
    getThumbPath,
    getAvatarPath,
    checkBatch,
    updateAvatar,
    cleanupTmp,
  };
}

module.exports = { createFileService, normalizeMime, decodeFileName, isSha256, formatBytes };
