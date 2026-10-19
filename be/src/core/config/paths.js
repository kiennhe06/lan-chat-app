/**
 * Mọi đường dẫn của server đi qua file này (không hardcode path ở nơi khác).
 *
 * BASE_DIR = thư mục chứa index.js (folder portable LANChat-Server/).
 *   - Override bằng env LANCHAT_SERVER_BASE_DIR (dùng cho test).
 * DATA_DIR = BASE_DIR/data (override bằng app-config.json "dataDir" hoặc env LANCHAT_DATA_DIR).
 */
'use strict';

const path = require('path');

const DEFAULT_BASE_DIR = process.env.LANCHAT_SERVER_BASE_DIR
  ? path.resolve(process.env.LANCHAT_SERVER_BASE_DIR)
  : path.resolve(__dirname, '..', '..', '..');

const CONFIG_FILE_NAME = 'app-config.json';
const DB_FILE_NAME = 'server.db';
const PRIVATE_KEY_FILE_NAME = 'server-ed25519.pem';
const PUBLIC_KEY_FILE_NAME = 'server-ed25519.pub.pem';

/**
 * Dựng bộ đường dẫn runtime.
 * @param {{ baseDir?: string, dataDir?: string|null }} [options]
 * @returns {Readonly<Record<string,string>>}
 */
function buildPaths(options) {
  const opts = options || {};
  const BASE_DIR = path.resolve(opts.baseDir || DEFAULT_BASE_DIR);
  // dataDir tương đối được tính từ BASE_DIR để folder portable luôn tự chứa dữ liệu
  const DATA_DIR = opts.dataDir ? path.resolve(BASE_DIR, opts.dataDir) : path.join(BASE_DIR, 'data');
  const LOGS_DIR = path.join(DATA_DIR, 'logs');
  const KEYS_DIR = path.join(DATA_DIR, 'keys');
  return Object.freeze({
    BASE_DIR,
    CONFIG_FILE: path.join(BASE_DIR, CONFIG_FILE_NAME),
    DATA_DIR,
    DB_SERVER: path.join(DATA_DIR, DB_FILE_NAME),
    ATTACHMENTS: path.join(DATA_DIR, 'attachments'),
    THUMBNAILS: path.join(DATA_DIR, 'thumbnails'),
    AVATARS: path.join(DATA_DIR, 'avatars'),
    TMP: path.join(DATA_DIR, 'tmp'),
    KEYS_DIR,
    PRIVATE_KEY: path.join(KEYS_DIR, PRIVATE_KEY_FILE_NAME),
    PUBLIC_KEY: path.join(KEYS_DIR, PUBLIC_KEY_FILE_NAME),
    LOGS_DIR,
    LOGS_SERVER: path.join(LOGS_DIR, 'server'),
    LOGS_CLIENTS: path.join(LOGS_DIR, 'clients'),
  });
}

/** Các thư mục cần tạo khi khởi động. */
function runtimeDirs(paths) {
  return [
    paths.DATA_DIR,
    paths.ATTACHMENTS,
    paths.THUMBNAILS,
    paths.AVATARS,
    paths.TMP,
    paths.KEYS_DIR,
    paths.LOGS_SERVER,
    paths.LOGS_CLIENTS,
  ];
}

const defaults = buildPaths();

module.exports = {
  ...defaults,
  DEFAULT_BASE_DIR,
  CONFIG_FILE_NAME,
  buildPaths,
  runtimeDirs,
};
