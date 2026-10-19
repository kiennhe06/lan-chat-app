/**
 * IPC: chọn file, tải xuống (dialog lưu → tải có progress), mở file / thư mục, lưu ảnh lightbox.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { IPC_INVOKE: I } = require('../../../ipc/channels');
const { ERROR_CODE, MAX_FILE_SIZE } = require('../../../shared/constants');
const { sanitizeFileName } = require('../../../shared/validators');
const { AppError, validationError } = require('../../core/utils/errors');
const { mimeFromName, fileExists, isSha256 } = require('../../core/utils/files');

const IMAGE_EXTENSIONS = Object.freeze(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp']);

/** Mô tả file đã chọn cho renderer */
function describeFile(filePath) {
  const stat = fs.statSync(filePath);
  return { path: filePath, name: path.basename(filePath), size: stat.size, mime_type: mimeFromName(filePath), too_large: stat.size > MAX_FILE_SIZE };
}

function assertPath(p) {
  if (typeof p !== 'string' || !p) throw validationError('Thiếu đường dẫn file.');
  return p;
}

/**
 * @param {{ platform: object, files: object, fileCache: object, paths: object }} ctx
 */
function createFileHandlers(ctx) {
  const { platform, files, fileCache, paths } = ctx;

  async function pick(options) {
    const res = await platform.showOpenDialog(options);
    if (!res || res.canceled) return [];
    return res.filePaths.filter((p) => fileExists(p)).map(describeFile);
  }

  return {
    [I.FILE_PICK]: () => pick({ title: 'Chọn file để gửi', properties: ['openFile', 'multiSelections'] }),
    [I.FILE_PICK_IMAGE]: () =>
      pick({ title: 'Chọn ảnh', properties: ['openFile'], filters: [{ name: 'Ảnh', extensions: IMAGE_EXTENSIONS }] }),
    [I.FILE_DOWNLOAD]: async (p) => {
      if (!p.file) throw validationError('Thiếu thông tin file.');
      const name = sanitizeFileName(p.file.name);
      const res = await platform.showSaveDialog({ title: 'Lưu file', defaultPath: path.join(paths.DEFAULT_DOWNLOAD, name) });
      if (!res || res.canceled || !res.filePath) return null;
      return files.startDownload({ client_message_id: p.client_message_id || null, file: p.file, destPath: res.filePath });
    },
    [I.FILE_CANCEL_DOWNLOAD]: (p) => ({ cancelled: files.cancelDownload(String(p.download_id || '')) }),
    [I.FILE_OPEN]: async (p) => {
      const target = assertPath(p.path);
      if (!fileExists(target)) throw new AppError(ERROR_CODE.NOT_FOUND, 'File không còn tồn tại trên máy.');
      const err = await platform.openPath(target);
      if (err) throw new AppError(ERROR_CODE.INTERNAL, `Không mở được file: ${err}`);
      return { ok: true };
    },
    [I.FILE_SHOW_IN_FOLDER]: (p) => {
      const target = assertPath(p.path);
      if (!fileExists(target)) throw new AppError(ERROR_CODE.NOT_FOUND, 'File không còn tồn tại trên máy.');
      platform.showItemInFolder(target);
      return { ok: true };
    },
    [I.FILE_EXISTS]: (p) => fileExists(p.path),
    [I.FILE_SAVE_IMAGE]: async (p) => {
      if (!isSha256(p.sha256)) throw validationError('Ảnh không hợp lệ.');
      const hit = await fileCache.resolveImage(p.sha256);
      if (!hit) throw new AppError(ERROR_CODE.NOT_FOUND, 'Ảnh chưa có trên máy và server đang offline.');
      const name = sanitizeFileName(p.name || `${p.sha256.slice(0, 12)}.png`);
      const res = await platform.showSaveDialog({ title: 'Lưu ảnh', defaultPath: path.join(paths.DEFAULT_DOWNLOAD, name) });
      if (!res || res.canceled || !res.filePath) return null;
      await fs.promises.copyFile(hit.path, res.filePath);
      return { path: res.filePath };
    },
  };
}

module.exports = { createFileHandlers };
