/**
 * Tự khởi động cùng Windows bằng shortcut .lnk trong thư mục shell:startup (KHÔNG ghi registry).
 * Ứng dụng portable: target là file .exe gốc (PORTABLE_EXECUTABLE_FILE), không phải bản giải nén tạm.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { app, shell } = require('electron');
const { ERROR_CODE } = require('../../shared/constants');
const { AppError } = require('./utils/errors');

const SHORTCUT_NAME = 'LAN Chat.lnk';

const isWindows = () => process.platform === 'win32';

function shortcutPath() {
  return path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', SHORTCUT_NAME);
}

/** @returns {{ enabled: boolean, supported: boolean }} */
function getAutoStart() {
  if (!isWindows()) return { enabled: false, supported: false };
  return { enabled: fs.existsSync(shortcutPath()), supported: true };
}

/**
 * @param {boolean} enabled
 * @returns {{ enabled: boolean, supported: boolean }}
 */
function setAutoStart(enabled) {
  if (!isWindows()) {
    throw new AppError(ERROR_CODE.VALIDATION, 'Tự khởi động chỉ hỗ trợ trên Windows (shortcut trong thư mục Startup).');
  }
  const lnk = shortcutPath();
  if (enabled) {
    const target = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
    const ok = shell.writeShortcutLink(lnk, 'create', {
      target,
      cwd: process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(target),
      description: 'LAN Chat',
      args: '--hidden',
    });
    if (!ok) throw new AppError(ERROR_CODE.INTERNAL, 'Không tạo được shortcut khởi động cùng Windows.');
  } else if (fs.existsSync(lnk)) {
    fs.unlinkSync(lnk);
  }
  return getAutoStart();
}

module.exports = { getAutoStart, setAutoStart };
