/**
 * Upload/download file với server qua HTTP (progress + hủy), và copy local khi file đã có sẵn
 * (nhận P2P / tải trước đó) để tải xuống được cả khi server offline.
 *
 * Không copy file người dùng vào thư mục app khi GỬI — upload stream thẳng từ đường dẫn gốc.
 */
'use strict';

const fs = require('fs');
const crypto = require('crypto');
const { ERROR_CODE, LOG_CATEGORY, MAX_FILE_SIZE, MAX_AVATAR_SIZE } = require('../../../shared/constants');
const { IPC_EVENTS } = require('../../../ipc/channels');
const { AppError, offlineError } = require('../../core/utils/errors');
const { fileExists } = require('../../core/utils/files');
const httpClient = require('../connection/httpClient');

const UPLOAD_STATE = Object.freeze({ UPLOADING: 'uploading', DONE: 'done', ERROR: 'error', CANCELLED: 'cancelled' });
const DOWNLOAD_STATE = Object.freeze({ DOWNLOADING: 'downloading', DONE: 'done', ERROR: 'error', CANCELLED: 'cancelled' });

class FileTransferService {
  /**
   * @param {{ session: object, repos: object, view: object, emit: Function, logger: object, http?: typeof httpClient }} deps
   */
  constructor(deps) {
    this.session = deps.session;
    this.repos = deps.repos;
    this.view = deps.view;
    this.emit = deps.emit;
    this.log = deps.logger;
    this.http = deps.http || httpClient;
    this.uploads = new Map(); // client_message_id → AbortController
    this.downloads = new Map(); // download_id → { controller, client_message_id }
  }

  _serverTarget() {
    const server = this.session.getServer();
    if (!this.session.isOnline() || !server) throw offlineError();
    return { host: server.host, port: server.port, token: this.session.getToken() };
  }

  /**
   * Upload file của 1 tin (phát evt:upload-progress). Trả WireFile.
   * @param {string} cmid
   * @param {{ filePath?: string, buffer?: Buffer, name: string, mimeType: string, size: number }} src
   */
  async uploadForMessage(cmid, src) {
    const target = this._serverTarget();
    const controller = new AbortController();
    this.uploads.set(cmid, controller);
    const report = (state, percent, error) => {
      this.view.setUploadPercent(cmid, state === UPLOAD_STATE.UPLOADING ? percent : null);
      this.emit(IPC_EVENTS.UPLOAD_PROGRESS, { client_message_id: cmid, percent, state, ...(error ? { error } : {}) });
    };
    report(UPLOAD_STATE.UPLOADING, 0);
    try {
      const body = await this.http.upload({
        ...target,
        path: '/upload',
        filePath: src.filePath,
        buffer: src.buffer,
        size: src.size,
        name: src.name,
        mimeType: src.mimeType,
        signal: controller.signal,
        onProgress: (pct) => report(UPLOAD_STATE.UPLOADING, pct),
      });
      if (!body || !body.file) throw new AppError(ERROR_CODE.INTERNAL, 'Server không trả thông tin file sau khi upload');
      report(UPLOAD_STATE.DONE, 100);
      this.log.info(LOG_CATEGORY.FILE, 'upload_done', { client_message_id: cmid, size: src.size, sha256: body.file.sha256 });
      return body.file;
    } catch (err) {
      const cancelled = err.code === ERROR_CODE.CANCELLED;
      report(cancelled ? UPLOAD_STATE.CANCELLED : UPLOAD_STATE.ERROR, 0, cancelled ? undefined : err.message);
      this.log.warn(LOG_CATEGORY.FILE, cancelled ? 'upload_cancelled' : 'upload_failed', { client_message_id: cmid, code: err.code });
      throw err;
    } finally {
      this.uploads.delete(cmid);
    }
  }

  /** Upload không phát progress (dùng trong sync) */
  async uploadRaw(src) {
    const target = this._serverTarget();
    const body = await this.http.upload({ ...target, path: '/upload', ...src });
    if (!body || !body.file) throw new AppError(ERROR_CODE.INTERNAL, 'Server không trả thông tin file sau khi upload');
    return body.file;
  }

  /** @returns {boolean} có upload đang chạy để hủy không */
  cancelUpload(cmid) {
    const c = this.uploads.get(cmid);
    if (!c) return false;
    c.abort();
    return true;
  }

  isUploading(cmid) {
    return this.uploads.has(cmid);
  }

  /** Tìm bản local của file theo sha256 (P2P / đã tải / file gốc khi gửi) */
  findLocalCopy(sha256) {
    if (!sha256) return null;
    const p2p = this.repos.p2pFiles.get(sha256);
    const candidates = [
      ...(p2p ? [p2p.local_path] : []),
      ...this.repos.downloads.pathsBySha(sha256),
      ...this.repos.messages.localPathsBySha(sha256),
    ];
    return candidates.find((p) => fileExists(p)) || null;
  }

  /**
   * Bắt đầu tải file của 1 tin về destPath (chạy nền, progress qua evt:download-progress).
   * Có bản local (P2P/đã tải) → copy, không cần server.
   * @param {{ client_message_id: string, file: object, destPath: string }} input
   * @returns {{ download_id: string, local_path: string }}
   */
  startDownload(input) {
    const { client_message_id: cmid, file, destPath } = input;
    if (!file || (!file.id && !file.sha256)) throw new AppError(ERROR_CODE.VALIDATION, 'Thiếu thông tin file');
    const localCopy = this.findLocalCopy(file.sha256);
    if (!localCopy && (!file.id || !this.session.isOnline())) {
      throw offlineError('File chưa có trên máy này và server đang offline — chưa tải được.');
    }
    if (file.size && file.size > MAX_FILE_SIZE) throw new AppError(ERROR_CODE.TOO_LARGE, 'File quá lớn.');

    const downloadId = crypto.randomUUID();
    const controller = new AbortController();
    this.downloads.set(downloadId, { controller, client_message_id: cmid });
    const report = (state, percent, extra) =>
      this.emit(IPC_EVENTS.DOWNLOAD_PROGRESS, { download_id: downloadId, client_message_id: cmid, percent, state, ...(extra || {}) });

    const run = localCopy
      ? fs.promises.copyFile(localCopy, destPath).then(() => report(DOWNLOAD_STATE.DOWNLOADING, 100))
      : (() => {
          const target = this._serverTarget();
          return this.http.downloadToFile({
            ...target,
            path: `/download/${encodeURIComponent(file.id)}`,
            destPath,
            signal: controller.signal,
            maxBytes: MAX_FILE_SIZE,
            onProgress: (pct) => report(DOWNLOAD_STATE.DOWNLOADING, pct),
          });
        })();

    report(DOWNLOAD_STATE.DOWNLOADING, 0);
    run
      .then(() => {
        this.repos.downloads.set(cmid, destPath, file.sha256);
        if (cmid) this.repos.messages.setLocalPath(cmid, destPath);
        this.log.info(LOG_CATEGORY.FILE, 'download_done', { client_message_id: cmid, size: file.size, local: !!localCopy });
        report(DOWNLOAD_STATE.DONE, 100, { local_path: destPath });
        if (cmid) this.view.emitMessage(cmid);
      })
      .catch((err) => {
        const cancelled = err.code === ERROR_CODE.CANCELLED;
        this.log.warn(LOG_CATEGORY.FILE, cancelled ? 'download_cancelled' : 'download_failed', { client_message_id: cmid, code: err.code, message: err.message });
        report(cancelled ? DOWNLOAD_STATE.CANCELLED : DOWNLOAD_STATE.ERROR, 0, cancelled ? undefined : { error: err.message || 'Tải file thất bại' });
      })
      .finally(() => this.downloads.delete(downloadId));
    return { download_id: downloadId, local_path: destPath };
  }

  cancelDownload(downloadId) {
    const d = this.downloads.get(downloadId);
    if (!d) return false;
    d.controller.abort();
    return true;
  }

  /**
   * Tải 1 đường dẫn server vào file cache (dùng cho lcfile://). Trả path hoặc null.
   * @param {string} urlPath vd "/thumb/<sha>"
   * @param {string} destPath
   * @param {boolean} [withToken]
   */
  async fetchToCache(urlPath, destPath, withToken) {
    const server = this.session.getServer();
    if (!this.session.isOnline() || !server) return null;
    try {
      await this.http.downloadToFile({
        host: server.host,
        port: server.port,
        token: withToken ? this.session.getToken() : undefined,
        path: urlPath,
        destPath,
        maxBytes: MAX_FILE_SIZE,
      });
      return destPath;
    } catch (err) {
      if (err.code !== ERROR_CODE.NOT_FOUND) this.log.debug(LOG_CATEGORY.FILE, 'cache_fetch_failed', { urlPath, code: err.code });
      return null;
    }
  }

  /**
   * Upload avatar (POST /avatar). Trả {user}.
   * @param {{ filePath?: string, buffer?: Buffer, mimeType: string, size: number }} src
   */
  async uploadAvatar(src) {
    if (src.size > MAX_AVATAR_SIZE) throw new AppError(ERROR_CODE.TOO_LARGE, 'Ảnh đại diện tối đa 10MB.');
    const target = this._serverTarget();
    const body = await this.http.upload({ ...target, path: '/avatar', ...src });
    if (!body || !body.user) throw new AppError(ERROR_CODE.INTERNAL, 'Server không trả thông tin người dùng');
    return body;
  }

  /** Hủy mọi truyền tải (logout / thoát) */
  abortAll() {
    for (const c of this.uploads.values()) c.abort();
    for (const d of this.downloads.values()) d.controller.abort();
  }
}

module.exports = { FileTransferService, UPLOAD_STATE, DOWNLOAD_STATE };
