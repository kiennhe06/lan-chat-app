/**
 * HTTP tới server LAN (node:http thuần): upload stream có progress, download ra file có progress,
 * hỗ trợ hủy bằng AbortSignal. Không import Electron. Không bao giờ gọi ra Internet — host luôn là server LAN.
 */
'use strict';

const fs = require('fs');
const http = require('http');
const { ERROR_CODE } = require('../../../shared/constants');
const { AppError } = require('../../core/utils/errors');

const PROGRESS_THROTTLE_MS = 150;
const UPLOAD_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 60 * 1000;

/** Gói hàm progress để không bắn quá dày */
function throttledProgress(onProgress) {
  let last = 0;
  let lastPct = -1;
  return (done, total, force) => {
    if (!onProgress) return;
    const pct = total > 0 ? Math.min(100, Math.floor((done / total) * 100)) : 0;
    const now = Date.now();
    if (force || (pct !== lastPct && now - last >= PROGRESS_THROTTLE_MS)) {
      last = now;
      lastPct = pct;
      onProgress(pct, done, total);
    }
  };
}

function mapNetworkError(err, signal) {
  if (signal && signal.aborted) return new AppError(ERROR_CODE.CANCELLED, 'Đã hủy.');
  if (err instanceof AppError) return err;
  return new AppError(ERROR_CODE.SERVER_OFFLINE, `Lỗi kết nối server: ${err.message}`);
}

/** Đọc body JSON từ response */
function readJson(res) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('error', reject);
    res.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      try {
        resolve(text ? JSON.parse(text) : {});
      } catch (_err) {
        resolve({ raw: text });
      }
    });
  });
}

/** Chuyển HTTP status lỗi → AppError tiếng Việt */
function httpError(status, body) {
  const serverErr = body && body.error;
  if (serverErr && serverErr.code) return new AppError(serverErr.code, serverErr.message || 'Server từ chối yêu cầu');
  if (status === 401) return new AppError(ERROR_CODE.UNAUTHORIZED, 'Phiên đăng nhập không hợp lệ.');
  if (status === 403) return new AppError(ERROR_CODE.FORBIDDEN, 'Server từ chối truy cập.');
  if (status === 404) return new AppError(ERROR_CODE.NOT_FOUND, 'Không tìm thấy file trên server.');
  if (status === 413) return new AppError(ERROR_CODE.TOO_LARGE, 'File vượt quá giới hạn cho phép của server.');
  return new AppError(ERROR_CODE.INTERNAL, `Server trả lỗi HTTP ${status}`);
}

/**
 * Upload raw bytes (POST). Nguồn: filePath (stream) hoặc buffer.
 * @param {{ host: string, port: number, path: string, token?: string, filePath?: string, buffer?: Buffer,
 *   size: number, name?: string, mimeType?: string, onProgress?: Function, signal?: AbortSignal }} o
 * @returns {Promise<object>} JSON body
 */
function upload(o) {
  return new Promise((resolve, reject) => {
    const progress = throttledProgress(o.onProgress);
    const headers = {
      'Content-Type': o.mimeType || 'application/octet-stream',
      'Content-Length': o.size,
    };
    if (o.token) headers.Authorization = `Bearer ${o.token}`;
    if (o.name) headers['X-File-Name'] = encodeURIComponent(o.name);
    let settled = false;
    const finish = (fn, v) => {
      if (!settled) {
        settled = true;
        fn(v);
      }
    };

    const req = http.request(
      { host: o.host, port: o.port, path: o.path, method: 'POST', headers, signal: o.signal, timeout: UPLOAD_TIMEOUT_MS },
      (res) => {
        readJson(res)
          .then((body) => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              progress(o.size, o.size, true);
              finish(resolve, body);
            } else {
              finish(reject, httpError(res.statusCode, body));
            }
          })
          .catch((err) => finish(reject, mapNetworkError(err, o.signal)));
      },
    );
    req.on('timeout', () => req.destroy(new AppError(ERROR_CODE.TIMEOUT, 'Upload quá thời gian chờ.')));
    req.on('error', (err) => finish(reject, mapNetworkError(err, o.signal)));

    if (o.buffer) {
      req.end(o.buffer);
      progress(o.size, o.size, true);
      return;
    }
    let sent = 0;
    const stream = fs.createReadStream(o.filePath);
    stream.on('data', (chunk) => {
      sent += chunk.length;
      progress(sent, o.size);
    });
    stream.on('error', (err) => {
      req.destroy();
      finish(reject, new AppError(ERROR_CODE.NOT_FOUND, `Không đọc được file: ${err.message}`));
    });
    stream.pipe(req);
  });
}

/**
 * GET ra file (ghi .part rồi rename — không để file dở dang khi lỗi/hủy).
 * @param {{ host: string, port: number, path: string, token?: string, destPath: string,
 *   onProgress?: Function, signal?: AbortSignal, maxBytes?: number }} o
 * @returns {Promise<{ path: string, size: number, contentType: string|null }>}
 */
function downloadToFile(o) {
  return new Promise((resolve, reject) => {
    const progress = throttledProgress(o.onProgress);
    const partPath = `${o.destPath}.part`;
    const headers = {};
    if (o.token) headers.Authorization = `Bearer ${o.token}`;
    let settled = false;
    const cleanup = () => fs.promises.unlink(partPath).catch(() => {});
    const fail = (err) => {
      if (settled) return;
      settled = true;
      cleanup().finally(() => reject(mapNetworkError(err, o.signal)));
    };

    const req = http.request(
      { host: o.host, port: o.port, path: o.path, method: 'GET', headers, signal: o.signal, timeout: DEFAULT_TIMEOUT_MS },
      (res) => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          readJson(res).then((body) => fail(httpError(res.statusCode, body)), fail);
          return;
        }
        const total = Number(res.headers['content-length']) || 0;
        if (o.maxBytes && total > o.maxBytes) {
          res.destroy();
          fail(new AppError(ERROR_CODE.TOO_LARGE, 'File quá lớn.'));
          return;
        }
        let received = 0;
        const out = fs.createWriteStream(partPath);
        res.on('data', (chunk) => {
          received += chunk.length;
          progress(received, total || received);
        });
        res.on('error', (err) => {
          out.destroy();
          fail(err);
        });
        out.on('error', (err) => {
          res.destroy();
          fail(new AppError(ERROR_CODE.INTERNAL, `Không ghi được file: ${err.message}`));
        });
        out.on('finish', () => {
          if (settled) return;
          if (total && received !== total) {
            fail(new AppError(ERROR_CODE.INTERNAL, 'Tải file không đầy đủ (mất kết nối giữa chừng).'));
            return;
          }
          fs.promises
            .rename(partPath, o.destPath)
            .then(() => {
              settled = true;
              progress(received, received, true);
              resolve({ path: o.destPath, size: received, contentType: res.headers['content-type'] || null });
            })
            .catch((err) => fail(new AppError(ERROR_CODE.INTERNAL, `Không lưu được file: ${err.message}`)));
        });
        res.pipe(out);
      },
    );
    req.on('timeout', () => req.destroy(new AppError(ERROR_CODE.TIMEOUT, 'Server không phản hồi.')));
    req.on('error', fail);
    req.end();
  });
}

module.exports = { upload, downloadToFile, httpError };
