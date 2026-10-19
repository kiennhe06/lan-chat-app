/**
 * Cửa sổ chính: bảo mật (contextIsolation, không nodeIntegration, chặn điều hướng/popup ra ngoài),
 * đóng cửa sổ → ẩn xuống tray, trang lỗi khi thiếu bản build renderer.
 */
'use strict';

const fs = require('fs');
const { BrowserWindow, shell } = require('electron');
const { LOG_CATEGORY } = require('../../shared/constants');

const WINDOW_DEFAULTS = Object.freeze({ width: 1200, height: 800, minWidth: 900, minHeight: 600 });

/** Chỉ mở link http(s) ra trình duyệt hệ thống (người dùng chủ động click) */
function isExternalHttpUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch (_err) {
    return false;
  }
}

/** HTML lỗi tối giản (không tài nguyên ngoài) khi chưa build renderer */
function missingRendererPage(expectedPath) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>LAN Chat</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<style>body{font-family:system-ui,sans-serif;background:#111827;color:#e5e7eb;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.box{max-width:560px;padding:24px;border:1px solid #374151;border-radius:12px}code{color:#fca5a5;word-break:break-all}</style></head>
<body><div class="box"><h2>Không tìm thấy giao diện LAN Chat</h2>
<p>Thiếu bản build renderer tại:</p><p><code>${esc(expectedPath)}</code></p>
<p>Chạy <code>npm run build:renderer</code> rồi mở lại ứng dụng.</p></div></body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

/**
 * @param {{ paths: object, devServerUrl: string|null, logger: object, showOnReady?: boolean }} opts
 */
function createWindowManager(opts) {
  const { paths, devServerUrl, logger } = opts;
  let win = null;
  let quitting = false;
  let appOrigin = null;

  function isAppUrl(url) {
    if (url.startsWith('file://')) return !devServerUrl;
    try {
      return !!appOrigin && new URL(url).origin === appOrigin;
    } catch (_err) {
      return false;
    }
  }

  function harden(w) {
    w.webContents.setWindowOpenHandler(({ url }) => {
      if (isExternalHttpUrl(url)) {
        shell.openExternal(url).catch((err) => logger.warn(LOG_CATEGORY.APP, 'open_external_failed', { message: err.message }));
      }
      return { action: 'deny' };
    });
    w.webContents.on('will-navigate', (event, url) => {
      if (isAppUrl(url)) return;
      event.preventDefault();
      if (isExternalHttpUrl(url)) {
        shell.openExternal(url).catch((err) => logger.warn(LOG_CATEGORY.APP, 'open_external_failed', { message: err.message }));
      }
    });
    w.webContents.on('will-attach-webview', (event) => event.preventDefault());
    w.webContents.on('render-process-gone', (_e, details) => logger.error(LOG_CATEGORY.APP, 'renderer_gone', details));
    w.webContents.on('did-fail-load', (_e, code, desc, url) => logger.error(LOG_CATEGORY.APP, 'renderer_load_failed', { code, desc, url }));
  }

  async function load(w) {
    if (devServerUrl) {
      appOrigin = new URL(devServerUrl).origin;
      await w.loadURL(devServerUrl);
      return;
    }
    if (!fs.existsSync(paths.RENDERER_INDEX)) {
      logger.error(LOG_CATEGORY.APP, 'renderer_missing', { path: paths.RENDERER_INDEX });
      await w.loadURL(missingRendererPage(paths.RENDERER_INDEX));
      return;
    }
    await w.loadFile(paths.RENDERER_INDEX);
  }

  /** Tạo + load cửa sổ chính */
  async function create() {
    win = new BrowserWindow({
      ...WINDOW_DEFAULTS,
      show: false,
      title: 'LAN Chat',
      icon: fs.existsSync(paths.ICON_PNG) ? paths.ICON_PNG : undefined,
      autoHideMenuBar: true,
      backgroundColor: '#ffffff',
      webPreferences: {
        preload: paths.PRELOAD,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false, // preload require module CommonJS local (shared/, common/)
        webSecurity: true,
        spellcheck: false,
        webviewTag: false,
      },
    });
    harden(win);
    win.once('ready-to-show', () => {
      if (opts.showOnReady !== false) win.show();
    });
    win.on('close', (event) => {
      if (quitting) return;
      // Đóng cửa sổ → ẩn xuống tray, app vẫn chạy để nhận tin
      event.preventDefault();
      win.hide();
    });
    win.on('focus', () => win.flashFrame(false));
    win.on('closed', () => {
      win = null;
    });
    await load(win);
    return win;
  }

  return {
    create,
    get: () => win,
    /** Gửi event xuống renderer (bỏ qua nếu cửa sổ chưa có / đã hủy) */
    send(channel, payload) {
      if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(channel, payload);
    },
    showAndFocus() {
      if (!win) return;
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    },
    isFocused: () => !!win && !win.isDestroyed() && win.isVisible() && win.isFocused(),
    flash() {
      if (win && !win.isDestroyed() && !win.isFocused()) win.flashFrame(true);
    },
    setQuitting() {
      quitting = true;
    },
  };
}

module.exports = { createWindowManager, isExternalHttpUrl };
