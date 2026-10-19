#!/usr/bin/env node
/**
 * LAN Chat Server — entry point. Chạy: `node index.js` (Node portable trong ./node/ hoặc Node cài sẵn).
 *
 * Trình tự khởi động:
 *   nạp cấu hình (env → app-config.json → mặc định) → tạo thư mục data/ → log service → mở server.db (WAL + migration)
 *   → khóa Ed25519 → services → HTTP + WebSocket cùng cổng → UDP discovery (:41234) + broadcast cho peer (:5003).
 * Tắt êm (SIGINT/SIGTERM/SIGBREAK): dừng broadcast → đóng WS/HTTP → checkpoint + đóng DB.
 *
 * Export startServer(options) / stop() để test chạy in-process với cổng + thư mục dữ liệu riêng.
 */
'use strict';

const fs = require('fs');
const http = require('http');
const C = require('../shared/constants');
const { loadConfig } = require('./config/configLoader');
const { runtimeDirs } = require('./config/paths');
const { openDatabase, closeDatabase } = require('./db/database');
const { createRepositories } = require('./db/repositories');
const { createLogService } = require('../modules/log/logService');
const { createTokenService } = require('../modules/auth/tokenService');
const { createConversationAccess } = require('../modules/chat/conversationAccess');
const { createAuthService } = require('../modules/auth/authService');
const { createMessageService } = require('../modules/chat/messageService');
const { createConversationService } = require('../modules/chat/conversationService');
const { createFileService } = require('../modules/file/fileService');
const { createSyncService } = require('../modules/sync/syncService');
const { createAdminService } = require('../modules/admin/adminService');
const { createPresenceService } = require('../modules/presence/presenceService');
const { createLogAggregator } = require('../modules/log/logAggregator');
const { createMemberDirectory } = require('../modules/admin/memberDirectory');
const { createPeerDiscoveryBroadcast } = require('../modules/presence/peerDiscoveryBroadcast');
const { createHub } = require('./hub');
const { createHttpHandler } = require('../transport/http');
const { createWsServer } = require('../transport/ws');
const { createDiscovery } = require('../transport/discovery');
const { listIpv4Interfaces } = require('./utils/network');

const CAT = C.LOG_CATEGORY.APP;
const HTTP_REQUEST_TIMEOUT_MS = 30 * 60 * 1000; // upload 200MB qua Wi-Fi chậm vẫn kịp
const SHUTDOWN_GRACE_MS = 5000;

let currentInstance = null;

/** Chuyển options rút gọn của startServer thành object override cấu hình. */
function toOverrides(options) {
  const o = options.overrides ? { ...options.overrides } : {};
  if (options.dataDir) o.dataDir = options.dataDir;
  if (options.port !== undefined) o.server = { ...(o.server || {}), port: options.port };
  if (options.host) o.server = { ...(o.server || {}), host: options.host };
  if (options.discovery !== undefined) o.discovery = { ...(o.discovery || {}), enabled: !!options.discovery };
  if (options.peerBroadcast !== undefined) o.p2p = { ...(o.p2p || {}), broadcastEnabled: !!options.peerBroadcast };
  return o;
}

/** Tạo các thư mục runtime (data/, attachments/, logs/...). */
function ensureDirs(paths) {
  for (const dir of runtimeDirs(paths)) fs.mkdirSync(dir, { recursive: true });
}

/** Khởi tạo toàn bộ services (dependency injection thủ công). */
function createServices({ config, paths, repos, logger, hub, tokenService }) {
  const access = createConversationAccess(repos);
  const message = createMessageService({ repos, access, hub, logger });
  const conversation = createConversationService({ repos, access, hub, logger, messageService: message });
  const auth = createAuthService({ repos, tokenService, logger, hub, config });
  const file = createFileService({ repos, paths, config, logger, authService: auth });
  const admin = createAdminService({ repos, hub, logger });
  const presence = createPresenceService({ hub, access, repos, logger });
  const logAggregator = createLogAggregator({ repos, paths, config, logger, serverWriter: logger.writer });
  const sync = createSyncService({ repos, hub, logger, config, messageService: message, conversationService: conversation, fileService: file, authService: auth });
  const memberDirectory = createMemberDirectory({ repos, hub });
  return { access, message, conversation, auth, file, admin, presence, logAggregator, memberDirectory, sync };
}

/** Lắng nghe cổng; lỗi (EADDRINUSE...) → reject với thông báo rõ. */
function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    const onError = (err) => {
      server.removeListener('listening', onListening);
      const hint = err.code === 'EADDRINUSE' ? ` — cổng ${port} đang được dùng (server khác đang chạy?)` : '';
      reject(new Error(`Không mở được cổng ${host}:${port}: ${err.message}${hint}`));
    };
    const onListening = () => {
      server.removeListener('error', onError);
      resolve(server.address().port);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

/** Việc dọn dẹp định kỳ (session hết hạn, log client cũ). */
function startMaintenance({ repos, services, logger, config }) {
  const run = () => {
    try {
      repos.sessions.deleteExpired(new Date().toISOString());
      services.logAggregator.cleanup();
    } catch (err) {
      logger.error(C.LOG_CATEGORY.ERROR, 'maintenance_failed', { error: err });
    }
  };
  run();
  const timer = setInterval(run, config.logging.cleanupIntervalMs);
  timer.unref();
  return timer;
}

/**
 * Khởi động server.
 * @param {{ baseDir?: string, dataDir?: string, port?: number, host?: string, discovery?: boolean,
 *   peerBroadcast?: boolean, overrides?: object, writeConfig?: boolean }} [options]
 * @returns {Promise<{ port: number, host: string, config: object, paths: object, services: object, hub: object, stop: () => Promise<void> }>}
 */
async function startServer(options) {
  const opts = options || {};
  const { config, paths, configCreated } = loadConfig({
    baseDir: opts.baseDir,
    overrides: toOverrides(opts),
    writeIfMissing: opts.writeConfig !== false,
  });
  ensureDirs(paths);
  const logger = createLogService({ dir: paths.LOGS_SERVER, config: config.logging });
  let db = null;
  try {
    db = openDatabase(paths.DB_SERVER);
  } catch (err) {
    logger.error(C.LOG_CATEGORY.ERROR, 'db_open_failed', { error: err, file: paths.DB_SERVER });
    throw err;
  }
  const repos = createRepositories(db);
  logger.setAuditRepo(repos.auditLog);
  logger.startRetention();

  const tokenService = createTokenService({
    keyFiles: { privateKeyFile: paths.PRIVATE_KEY, publicKeyFile: paths.PUBLIC_KEY },
    ttlMs: config.auth.sessionTtlMs,
  });
  const hub = createHub({ logger });
  const services = createServices({ config, paths, repos, logger, hub, tokenService });
  await services.file.cleanupTmp();
  const maintenanceTimer = startMaintenance({ repos, services, logger, config });

  const httpServer = http.createServer(createHttpHandler({ services, logger, config }));
  httpServer.requestTimeout = HTTP_REQUEST_TIMEOUT_MS;
  httpServer.on('clientError', (err, socket) => {
    logger.debug(C.LOG_CATEGORY.CONNECTION, 'http_client_error', { code: err.code });
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  });
  const wsServer = createWsServer({ httpServer, hub, services, logger, config });

  let port;
  try {
    port = await listen(httpServer, config.server.port, config.server.host);
  } catch (err) {
    logger.error(C.LOG_CATEGORY.ERROR, 'listen_failed', { error: err });
    clearInterval(maintenanceTimer);
    await wsServer.close();
    logger.stop();
    closeDatabase(db);
    throw err;
  }
  const getPort = () => port;
  const discovery = createDiscovery({ config, logger, getPort });
  const peerBroadcast = createPeerDiscoveryBroadcast({ config, logger, getPort });
  await Promise.all([discovery.start(), peerBroadcast.start()]);

  logger.logAudit(C.LOG_LEVEL.AUDIT, CAT, 'server_started', null, {
    port,
    host: config.server.host,
    data_dir: paths.DATA_DIR,
    config_created: configCreated,
    keys_created: tokenService.keysCreated,
    node: process.version,
  });

  let stopping = null;
  /** Tắt server (idempotent). */
  function stop() {
    if (stopping) return stopping;
    stopping = (async () => {
      logger.logAudit(C.LOG_LEVEL.AUDIT, CAT, 'server_stopping', null, {});
      discovery.stop();
      peerBroadcast.stop();
      clearInterval(maintenanceTimer);
      await wsServer.close();
      await new Promise((resolve) => {
        httpServer.close(() => resolve());
        httpServer.closeAllConnections();
      });
      logger.stop();
      try {
        closeDatabase(db);
      } catch (err) {
        logger.error(C.LOG_CATEGORY.ERROR, 'db_close_failed', { error: err });
      }
      if (currentInstance === instance) currentInstance = null;
    })();
    return stopping;
  }

  const instance = { port, host: config.server.host, config, paths, services, hub, logger, stop };
  currentInstance = instance;
  return instance;
}

/** Tắt instance được khởi động gần nhất. */
async function stop() {
  if (currentInstance) await currentInstance.stop();
}

/** In banner khởi động (chỉ khi chạy trực tiếp). */
function printBanner(instance) {
  const addrs = listIpv4Interfaces().map((i) => `ws://${i.address}:${instance.port}${C.NETWORK.WS_PATH}`);
  const lines = [
    `${C.APP_NAME} Server v${C.APP_VERSION} — Node ${process.version}`,
    `  Đang lắng nghe: ${instance.host}:${instance.port} (HTTP + WebSocket ${C.NETWORK.WS_PATH})`,
    ...addrs.map((a) => `  Địa chỉ LAN : ${a}`),
    `  Discovery   : UDP ${instance.config.discovery.enabled ? instance.config.discovery.port : 'tắt'}`,
    `  Quản trị    : http://localhost:${instance.port}/admin  (chỉ mở được trên máy này)`,
    `  Dữ liệu     : ${instance.paths.DATA_DIR}`,
    '  Nhấn Ctrl+C để dừng.',
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
}

function runAsMain() {
  let shuttingDown = false;
  const shutdown = (signal, exitCode) => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.stdout.write(`Nhận ${signal}, đang tắt server...\n`);
    const force = setTimeout(() => process.exit(exitCode || 1), SHUTDOWN_GRACE_MS);
    force.unref();
    stop()
      .then(() => process.exit(exitCode || 0))
      .catch((err) => {
        process.stderr.write(`Lỗi khi tắt server: ${err.message}\n`);
        process.exit(1);
      });
  };
  ['SIGINT', 'SIGTERM', 'SIGBREAK'].forEach((sig) => process.on(sig, () => shutdown(sig, 0)));
  process.on('unhandledRejection', (reason) => {
    const logger = currentInstance && currentInstance.logger;
    if (logger) logger.error(C.LOG_CATEGORY.ERROR, 'unhandled_rejection', { error: reason instanceof Error ? reason : String(reason) });
    else process.stderr.write(`Unhandled rejection: ${reason}\n`);
  });
  process.on('uncaughtException', (err) => {
    const logger = currentInstance && currentInstance.logger;
    if (logger) logger.error(C.LOG_CATEGORY.ERROR, 'uncaught_exception', { error: err });
    process.stderr.write(`Lỗi nghiêm trọng: ${err.stack || err.message}\n`);
    shutdown('uncaughtException', 1);
  });

  startServer()
    .then(printBanner)
    .catch((err) => {
      process.stderr.write(`Khởi động server thất bại: ${err.message}\n`);
      process.exit(1);
    });
}

if (require.main === module) runAsMain();

module.exports = { startServer, stop, runAsMain };
