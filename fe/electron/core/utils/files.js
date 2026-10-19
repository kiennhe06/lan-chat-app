/**
 * Tiện ích file: SHA-256 dạng stream, đoán MIME, kiểm tra tồn tại.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SHA256_REGEX = /^[a-f0-9]{64}$/;

/** Bảng MIME tối thiểu theo phần mở rộng (không phụ thuộc thư viện ngoài) */
const MIME_BY_EXT = Object.freeze({
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.zip': 'application/zip',
  '.rar': 'application/vnd.rar',
  '.7z': 'application/x-7z-compressed',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
});

const EXT_BY_MIME = Object.freeze({
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/bmp': '.bmp',
  'image/tiff': '.tiff',
});

const DEFAULT_MIME = 'application/octet-stream';

/** @param {string} fileName */
function mimeFromName(fileName) {
  return MIME_BY_EXT[path.extname(String(fileName || '')).toLowerCase()] || DEFAULT_MIME;
}

/** Đoán MIME ảnh từ magic bytes (PNG/JPEG/GIF/WEBP/BMP) */
function sniffImageMime(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.slice(0, 3).toString('ascii') === 'GIF') return 'image/gif';
  if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (buf[0] === 0x42 && buf[1] === 0x4d) return 'image/bmp';
  return null;
}

/** Đọc vài byte đầu file để sniff MIME (null nếu lỗi) */
function sniffFileMime(filePath) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(16);
    fs.readSync(fd, buf, 0, 16, 0);
    return sniffImageMime(buf);
  } catch (_err) {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

/**
 * SHA-256 của file (stream, không đọc hết vào RAM).
 * @param {string} filePath
 * @returns {Promise<string>}
 */
function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

/** @param {Buffer} buf */
const sha256Buffer = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/** File tồn tại và là file thường */
function fileExists(filePath) {
  if (!filePath || typeof filePath !== 'string') return false;
  try {
    return fs.statSync(filePath).isFile();
  } catch (_err) {
    return false;
  }
}

const isSha256 = (v) => typeof v === 'string' && SHA256_REGEX.test(v);

module.exports = {
  MIME_BY_EXT,
  EXT_BY_MIME,
  DEFAULT_MIME,
  mimeFromName,
  sniffImageMime,
  sniffFileMime,
  sha256File,
  sha256Buffer,
  fileExists,
  isSha256,
};
