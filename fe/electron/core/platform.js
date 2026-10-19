/**
 * Adapter mỏng bọc API Electron cho IPC handler (dialog, shell, app) — handler không import Electron
 * trực tiếp nên test được bằng stub.
 */
'use strict';

const { app, dialog, shell } = require('electron');
const { APP_VERSION } = require('../../shared/constants');
const autoStart = require('./autoStart');

const CONFIRM_BUTTONS = Object.freeze({ CANCEL: 'Hủy', OK: 'Đồng ý' });

/**
 * @param {{ windowManager: object, paths: object, onQuit: () => void }} deps
 */
function createPlatform(deps) {
  const { windowManager, paths } = deps;
  const parent = () => {
    const w = windowManager.get();
    return w && !w.isDestroyed() ? w : undefined;
  };
  const withParent = (fn, options) => (parent() ? fn(parent(), options) : fn(options));

  return {
    appInfo: () => ({
      version: app.getVersion() || APP_VERSION,
      platform: process.platform,
      dataDir: paths.DATA_DIR,
      logsDir: paths.LOGS_DIR,
      downloadsDir: paths.DEFAULT_DOWNLOAD,
      isPortable: !!process.env.PORTABLE_EXECUTABLE_DIR,
    }),
    quit: () => deps.onQuit(),
    focusWindow: () => windowManager.showAndFocus(),
    getAutoStart: () => autoStart.getAutoStart(),
    setAutoStart: (enabled) => autoStart.setAutoStart(enabled),
    showOpenDialog: (options) => withParent(dialog.showOpenDialog, options),
    showSaveDialog: (options) => withParent(dialog.showSaveDialog, options),
    /** @returns {Promise<boolean>} true khi bấm "Đồng ý" */
    async confirm(o) {
      const res = await withParent(dialog.showMessageBox, {
        type: o.type || 'question',
        title: String(o.title || 'LAN Chat'),
        message: String(o.message || ''),
        detail: o.detail ? String(o.detail) : undefined,
        buttons: [String(o.cancelText || CONFIRM_BUTTONS.CANCEL), String(o.confirmText || CONFIRM_BUTTONS.OK)],
        defaultId: 1,
        cancelId: 0,
        noLink: true,
      });
      return res.response === 1;
    },
    async alert(o) {
      await withParent(dialog.showMessageBox, {
        type: ['info', 'warning', 'error'].includes(o.type) ? o.type : 'info',
        title: String(o.title || 'LAN Chat'),
        message: String(o.message || ''),
        detail: o.detail ? String(o.detail) : undefined,
        buttons: ['OK'],
        noLink: true,
      });
    },
    /** @returns {Promise<string>} chuỗi lỗi (rỗng nếu thành công) */
    openPath: (p) => shell.openPath(p),
    showItemInFolder: (p) => shell.showItemInFolder(p),
  };
}

module.exports = { createPlatform };
