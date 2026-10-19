/**
 * Mọi đường dẫn runtime của client — portable, dữ liệu nằm CẠNH file .exe (không %APPDATA%, không registry).
 *
 * BASE_DIR:
 *   - packaged (portable .exe): process.env.PORTABLE_EXECUTABLE_DIR (electron-builder portable đặt biến này
 *     trỏ tới thư mục chứa .exe gốc, vì app thực tế chạy từ thư mục tạm giải nén) hoặc dirname(process.execPath).
 *   - dev: thư mục project fe/ (hoặc env LANCHAT_CLIENT_BASE_DIR để chạy 2 client trên 1 máy khi test).
 *
 * Module thuần Node — không import Electron để test được bằng `node --test`.
 */
'use strict';

const path = require('path');

/** Thư mục project fe/ (electron/core/config → ../../..) */
const PROJECT_DIR = path.resolve(__dirname, '..', '..', '..');

const CONFIG_FILE_NAME = 'app-config.json';
const DATA_DIR_NAME = 'data';
const DB_FILE_NAME = 'client.db';

/**
 * Xác định BASE_DIR.
 * @param {{ isPackaged: boolean, env?: NodeJS.ProcessEnv, execPath?: string }} opts
 * @returns {string}
 */
function resolveBaseDir(opts) {
  const env = (opts && opts.env) || process.env;
  if (env.LANCHAT_CLIENT_BASE_DIR) return path.resolve(env.LANCHAT_CLIENT_BASE_DIR);
  if (opts && opts.isPackaged) {
    return env.PORTABLE_EXECUTABLE_DIR || path.dirname((opts && opts.execPath) || process.execPath);
  }
  return PROJECT_DIR;
}

/**
 * Dựng bảng đường dẫn từ BASE_DIR.
 * @param {string} baseDir
 */
function buildPaths(baseDir) {
  const DATA_DIR = path.join(baseDir, DATA_DIR_NAME);
  const LOGS_DIR = path.join(DATA_DIR, 'logs');
  const CACHE_DIR = path.join(DATA_DIR, 'cache');
  return Object.freeze({
    BASE_DIR: baseDir,
    PROJECT_DIR,
    DATA_DIR,
    DB_CLIENT: path.join(DATA_DIR, DB_FILE_NAME),
    LOGS_DIR,
    LOGS_CLIENTS: path.join(LOGS_DIR, 'clients'),
    DEFAULT_DOWNLOAD: path.join(DATA_DIR, 'downloads'),
    P2P_DOWNLOADS: path.join(DATA_DIR, 'downloads-p2p'),
    CACHE_DIR,
    CACHE_THUMBS: path.join(CACHE_DIR, 'thumbs'),
    CACHE_IMAGES: path.join(CACHE_DIR, 'images'),
    CACHE_AVATARS: path.join(CACHE_DIR, 'avatars'),
    TMP_DIR: path.join(DATA_DIR, 'tmp'),
    // Chromium userData/sessionData/crashDumps/logs — giữ cạnh .exe thay vì %APPDATA%
    ELECTRON_DATA: path.join(DATA_DIR, 'electron'),
    ELECTRON_SESSION: path.join(DATA_DIR, 'electron', 'session'),
    ELECTRON_CRASH_DUMPS: path.join(DATA_DIR, 'electron', 'crash-dumps'),
    ELECTRON_LOGS: path.join(LOGS_DIR, 'electron'),
    CONFIG_FILE: path.join(baseDir, CONFIG_FILE_NAME),
    // Tài nguyên tĩnh đóng gói cùng app (nằm trong asar)
    PRELOAD: path.join(PROJECT_DIR, 'preload', 'index.js'),
    RENDERER_INDEX: path.join(PROJECT_DIR, 'dist', 'ui', 'index.html'),
    ICON_PNG: path.join(PROJECT_DIR, 'build', 'icon.png'),
    TRAY_ICON: path.join(PROJECT_DIR, 'build', 'tray-icon.png'),
  });
}

/** Các thư mục cần tạo sẵn khi khởi động */
const DIRS_TO_ENSURE = Object.freeze([
  'DATA_DIR',
  'LOGS_CLIENTS',
  'DEFAULT_DOWNLOAD',
  'P2P_DOWNLOADS',
  'CACHE_THUMBS',
  'CACHE_IMAGES',
  'CACHE_AVATARS',
  'TMP_DIR',
  'ELECTRON_DATA',
  'ELECTRON_SESSION',
  'ELECTRON_CRASH_DUMPS',
  'ELECTRON_LOGS',
]);

/**
 * Tạo các thư mục dữ liệu (idempotent).
 * @param {ReturnType<typeof buildPaths>} paths
 * @param {typeof import('fs')} [fsImpl]
 */
function ensureDirs(paths, fsImpl) {
  const fs = fsImpl || require('fs');
  for (const key of DIRS_TO_ENSURE) {
    fs.mkdirSync(paths[key], { recursive: true });
  }
}

module.exports = { resolveBaseDir, buildPaths, ensureDirs, PROJECT_DIR, CONFIG_FILE_NAME };
