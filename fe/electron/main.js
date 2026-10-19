/**
 * Entry Electron main — LAN Chat client (portable, 100% offline LAN).
 *
 * Trình tự: đường dẫn portable + app.setPath (TRƯỚC ready) → single-instance lock → ready
 *   → config → log → DB + services (container) → lcfile:// → IPC → cửa sổ → tray → mạng (P2P/discovery).
 * Đóng cửa sổ → ẩn xuống tray; "Thoát" ở tray → dọn dẹp (DB, socket, UDP) rồi thoát.
 *
 * Cờ dòng lệnh:
 *   --dev-server=<url>  load renderer từ Vite (chỉ khi chưa đóng gói)
 *   --hidden            khởi động ẩn (dùng cho shortcut tự khởi động)
 *   --smoke-test        khởi tạo toàn bộ rồi tự thoát sau ~3s (exit 0; lỗi init → exit 1)
 */
'use strict';

const { app, ipcMain, Notification, session: electronSession } = require('electron');
const { buildPaths, resolveBaseDir, ensureDirs } = require('./core/config/paths');
const { loadConfig } = require('./core/config/configLoader');
const { createLogService } = require('./modules/log/logService');
const { createEventBus } = require('./core/eventBus');
const { createContainer } = require('./core/container');
const { createWindowManager } = require('./core/windowManager');
const { createTray } = require('./core/tray');
const { createPlatform } = require('./core/platform');
const { registerAll } = require('./core/ipc');
const lcfileProtocol = require('./core/lcfileProtocol');
const { IPC_EVENTS } = require('../ipc/channels');
const { LOG_CATEGORY, APP_VERSION } = require('../shared/constants');

const SMOKE_TEST = process.argv.includes('--smoke-test');
const START_HIDDEN = process.argv.includes('--hidden');
const SMOKE_DURATION_MS = 3000;
const APP_USER_MODEL_ID = 'local.lanchat.client';

/** CSP production (renderer cũng chèn thẻ meta khi build — header này là lớp bảo vệ thứ 2) */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "img-src 'self' data: blob: lcfile:",
  "media-src 'self' blob: lcfile:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "connect-src 'self'",
].join('; ');

function parseDevServerUrl() {
  if (app.isPackaged) return null;
  const arg = process.argv.find((a) => a.startsWith('--dev-server='));
  return arg ? arg.slice('--dev-server='.length) : null;
}

// ============ 1. Đường dẫn portable — PHẢI trước 'ready' ============
const paths = buildPaths(resolveBaseDir({ isPackaged: app.isPackaged }));
ensureDirs(paths);
app.setPath('userData', paths.ELECTRON_DATA);
app.setPath('sessionData', paths.ELECTRON_SESSION);
app.setPath('crashDumps', paths.ELECTRON_CRASH_DUMPS);
app.setAppLogsPath(paths.ELECTRON_LOGS);
// Offline 100%: tắt mọi network nền của Chromium
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-component-update');
app.commandLine.appendSwitch('no-pings');
if (process.platform === 'win32') app.setAppUserModelId(APP_USER_MODEL_ID);
lcfileProtocol.registerScheme();

// ============ 2. Single instance ============
// Lock gắn với userData → 2 client dùng LANCHAT_CLIENT_BASE_DIR khác nhau vẫn chạy song song được
const gotLock = SMOKE_TEST || app.requestSingleInstanceLock();

const state = {
  logger: null,
  container: null,
  windowManager: null,
  tray: null,
  quitting: false,
  cleanedUp: false,
};

function consoleFallbackLogger() {
  const out = (lvl) => (c, a, m) => console[lvl === 'error' ? 'error' : 'log'](`[${lvl}] ${c}/${a}`, m || '');
  return { log: (l, c, a, m) => out(l)(c, a, m), debug: out('debug'), info: out('info'), warn: out('warn'), error: out('error'), audit: out('audit') };
}

/** Dọn dẹp tài nguyên (idempotent) */
async function cleanup() {
  if (state.cleanedUp) return;
  state.cleanedUp = true;
  try {
    if (state.tray) state.tray.destroy();
    if (state.logger) state.logger.info(LOG_CATEGORY.APP, 'app_quit', {});
    if (state.container) await state.container.stop();
  } catch (err) {
    console.error('[main] lỗi khi dọn dẹp:', err);
  }
}

/** Thoát hẳn app (tray "Thoát", app:quit, smoke test) */
function quitApp(exitCode) {
  state.quitting = true;
  if (state.windowManager) state.windowManager.setQuitting();
  cleanup().finally(() => app.exit(exitCode || 0));
}

function installSecurityPolicies(devServerUrl, logger) {
  const ses = electronSession.defaultSession;
  ses.setSpellCheckerEnabled(false);
  if (!devServerUrl) {
    ses.webRequest.onHeadersReceived((details, callback) => {
      callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [CONTENT_SECURITY_POLICY] } });
    });
  }
  const allowed = new Set(['media', 'clipboard-sanitized-write', 'notifications', 'fullscreen']);
  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    const ok = allowed.has(permission);
    if (!ok) logger.warn(LOG_CATEGORY.APP, 'permission_denied', { permission });
    callback(ok);
  });
}

/** UI adapter cho service (notification, badge, focus) — late binding tới window/tray */
function createUiAdapter(eventBus) {
  return {
    isWindowFocused: () => !!state.windowManager && state.windowManager.isFocused(),
    notify({ title, body, conversation_id: conversationId }) {
      if (state.windowManager) state.windowManager.flash();
      if (!Notification.isSupported()) return;
      const n = new Notification({ title, body, silent: false });
      n.on('click', () => {
        if (state.windowManager) state.windowManager.showAndFocus();
        eventBus.emit(IPC_EVENTS.NOTIFICATION_CLICK, { conversation_id: conversationId });
      });
      n.show();
    },
    setUnreadCount(n) {
      if (process.platform !== 'win32') app.setBadgeCount(n);
      if (state.tray) state.tray.setUnread(n);
    },
  };
}

async function bootstrap() {
  const devServerUrl = parseDevServerUrl();
  const { config, warnings, created } = loadConfig({ configFile: paths.CONFIG_FILE });

  const eventBus = createEventBus();
  let containerRef = null;
  const logger = createLogService({
    dir: paths.LOGS_CLIENTS,
    level: config.logging.level,
    maxFileBytes: config.logging.maxFileSizeBytes,
    retentionDays: config.logging.retentionDays,
    logMessageContent: config.logging.logMessageContent,
    shipEnabled: config.logging.shipToServer,
    consoleEcho: !app.isPackaged && !SMOKE_TEST,
    getUserId: () => (containerRef ? containerRef.session.getUserId() : null),
  });
  state.logger = logger;
  logger.cleanupOld();
  logger.info(LOG_CATEGORY.APP, 'app_start', { version: APP_VERSION, baseDir: paths.BASE_DIR, packaged: app.isPackaged, smoke: SMOKE_TEST, configCreated: created });
  for (const w of warnings) logger.warn(LOG_CATEGORY.SETTINGS, 'config_warning', { message: w });

  installSecurityPolicies(devServerUrl, logger);

  const container = createContainer({ paths, config, logger, eventBus, ui: createUiAdapter(eventBus) });
  containerRef = container;
  state.container = container;

  lcfileProtocol.install(container.fileCache, logger);

  const windowManager = createWindowManager({ paths, devServerUrl, logger, showOnReady: !START_HIDDEN && !SMOKE_TEST });
  state.windowManager = windowManager;
  eventBus.setSink((channel, payload) => windowManager.send(channel, payload));

  const platform = createPlatform({ windowManager, paths, onQuit: () => quitApp(0) });
  const channels = registerAll(ipcMain, { ...container, platform, paths, logger, emit: eventBus.emit, discovery: container.serverDiscovery, view: container.view });
  logger.info(LOG_CATEGORY.APP, 'ipc_registered', { count: channels.length });

  await container.start();
  await windowManager.create();
  if (!SMOKE_TEST) {
    state.tray = createTray({
      iconPath: paths.TRAY_ICON,
      onOpen: () => windowManager.showAndFocus(),
      onQuit: () => quitApp(0),
      logger,
    });
  }
  container.view.refreshBadge();
  logger.info(LOG_CATEGORY.APP, 'app_ready', { instance_id: container.instanceId });
}

function fatal(err) {
  const logger = state.logger || consoleFallbackLogger();
  logger.error(LOG_CATEGORY.ERROR, 'bootstrap_failed', { message: err && err.message, stack: err && err.stack });
  console.error('[main] Khởi động thất bại:', err);
  if (SMOKE_TEST) {
    state.quitting = true;
    cleanup().finally(() => app.exit(1));
    return;
  }
  const { dialog } = require('electron');
  dialog.showErrorBox('LAN Chat — lỗi khởi động', `${(err && err.message) || err}\n\nXem log trong thư mục: ${paths.LOGS_CLIENTS}`);
  quitApp(1);
}

if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (state.windowManager) state.windowManager.showAndFocus();
  });
  // Ẩn xuống tray thay vì thoát khi đóng mọi cửa sổ
  app.on('window-all-closed', () => {});
  app.on('activate', () => {
    if (state.windowManager) state.windowManager.showAndFocus();
  });
  app.on('before-quit', (event) => {
    if (state.cleanedUp) return;
    // Thoát từ hệ điều hành (Cmd+Q, shutdown) → dọn dẹp trước
    event.preventDefault();
    quitApp(0);
  });

  process.on('uncaughtException', (err) => {
    (state.logger || consoleFallbackLogger()).error(LOG_CATEGORY.ERROR, 'uncaught_exception', { message: err.message, stack: err.stack });
    if (SMOKE_TEST) quitApp(1);
  });
  process.on('unhandledRejection', (reason) => {
    (state.logger || consoleFallbackLogger()).error(LOG_CATEGORY.ERROR, 'unhandled_rejection', { message: reason && reason.message ? reason.message : String(reason) });
    if (SMOKE_TEST) quitApp(1);
  });

  app
    .whenReady()
    .then(bootstrap)
    .then(() => {
      if (SMOKE_TEST) {
        setTimeout(() => {
          state.logger.info(LOG_CATEGORY.APP, 'smoke_test_ok', {});
          console.log('[smoke-test] main khởi tạo thành công');
          quitApp(0);
        }, SMOKE_DURATION_MS);
      }
    })
    .catch(fatal);
}
