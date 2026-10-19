/**
 * Composition root (không phụ thuộc Electron): tạo DB → repositories → services → P2P/discovery
 * và nối dây sự kiện giữa chúng. index.js chỉ thêm phần Electron (window, tray, IPC, protocol).
 */
'use strict';

const crypto = require('crypto');
const { LOG_CATEGORY } = require('../../shared/constants');
const { IPC_EVENTS } = require('../../ipc/channels');
const { openDatabase, closeDatabase, clearUserScopedData } = require('./db/database');
const { createRepositories } = require('./db/repositories');
const { ServerConnection } = require('../modules/connection/serverConnection');
const { SessionService, SETTINGS_KEYS } = require('../modules/auth/sessionService');
const { createLocalView } = require('../modules/chat/localView');
const { createMessageIngest } = require('../modules/chat/messageIngest');
const { createClockService } = require('../modules/chat/clockService');
const { FileTransferService } = require('../modules/file/fileTransferService');
const { createFileCacheService } = require('../modules/file/fileCacheService');
const { P2PService } = require('../modules/p2p/p2pService');
const { ChatService } = require('../modules/chat/chatService');
const { createInboundHandler } = require('../modules/chat/inboundService');
const { SyncService } = require('../modules/sync/syncService');
const { ServerDiscovery } = require('../modules/connection/serverDiscovery');
const { verifySessionToken } = require('../modules/auth/tokenVerifier');
const { createSyncClient } = require('../modules/sync/syncClient');
const { P2PNode } = require('../modules/p2p/p2pServer');
const { PeerRegistry } = require('../modules/p2p/peerRegistry');
const { PeerDiscovery } = require('../modules/p2p/peerDiscovery');

/**
 * @param {{ paths: object, config: object, logger: object, eventBus: { emit: Function },
 *   ui?: { notify?: Function, isWindowFocused?: Function, setUnreadCount?: Function } }} opts
 */
function createContainer(opts) {
  const { paths, config, logger, eventBus } = opts;
  const emit = (channel, payload) => eventBus.emit(channel, payload);
  const ui = opts.ui || {};

  const { db, applied } = openDatabase(paths.DB_CLIENT);
  if (applied.length) logger.info(LOG_CATEGORY.APP, 'db_migrated', { versions: applied });
  const repos = createRepositories(db);

  let instanceId = repos.settings.get(SETTINGS_KEYS.INSTANCE_ID, null);
  if (!instanceId) {
    instanceId = crypto.randomUUID();
    repos.settings.set(SETTINGS_KEYS.INSTANCE_ID, instanceId);
  }
  if (logger.setClientId) logger.setClientId(instanceId);

  const connection = new ServerConnection({
    requestTimeoutMs: config.network.requestTimeoutMs,
    reconnectMinMs: config.network.reconnectMinMs,
    reconnectMaxMs: config.network.reconnectMaxMs,
    logger,
  });
  const session = new SessionService({
    connection,
    repos,
    emit,
    logger,
    defaultPort: config.server.port,
    onUserChanged: (prevId, newId) => {
      logger.audit(LOG_CATEGORY.AUTH, 'local_data_reset_other_user', { prev_user_id: prevId, user_id: newId });
      clearUserScopedData(db);
    },
  });
  const getMyUserId = () => session.getUserId();
  const view = createLocalView({ repos, emit, getMyUserId, ui });
  const ingest = createMessageIngest({ repos, view, getMyUserId, ui, notificationsEnabled: config.notifications.enabled, logger });
  const clock = createClockService(repos.vectorClock);
  const files = new FileTransferService({ session, repos, view, emit, logger });
  const fileCache = createFileCacheService({ paths, repos, files });

  const registry = new PeerRegistry({ peersRepo: repos.peers, intervalMs: config.p2p.broadcastIntervalMs, logger });
  const p2pNode = new P2PNode({
    port: config.p2p.port,
    instanceId,
    logger,
    getHello: () => (session.isLoggedIn() && session.getToken() ? { session_token: session.getToken(), vector_clock: clock.current() } : null),
    verifyToken: (token) => verifySessionToken(token, session.getServerPublicKey()),
  });
  const peerDiscovery = new PeerDiscovery({
    port: config.p2p.discoveryPort,
    intervalMs: config.p2p.broadcastIntervalMs,
    instanceId,
    registry,
    logger,
    getAnnounce: () => {
      const user = session.getUser();
      if (!session.isLoggedIn() || !user) return null;
      return { user_id: user.id, display_name: user.display_name, peer_port: config.p2p.port, server_online: session.isOnline() };
    },
  });
  const serverDiscovery = new ServerDiscovery({ port: config.network.serverDiscoveryPort, logger });

  const p2p = new P2PService({ node: p2pNode, registry, repos, view, ingest, session, clock, emit, logger, paths });
  const chat = new ChatService({ session, repos, view, p2p, files, clock, logger, paths });
  const inbound = createInboundHandler({ repos, view, ingest, session, emit, logger });
  const sync = new SyncService({
    request: (type, data, o) => session.request(type, data, o),
    send: (type, data) => session.send(type, data),
    repos,
    view,
    emit,
    logger,
    files,
    getMyUserId,
  });
  const syncClient = createSyncClient({ session, syncService: sync, emit, logger });

  // ---------- nối dây sự kiện ----------
  p2p.attach();
  connection.on('frame', (frame) => inbound.handle(frame));
  logger.attachTransport({ isOnline: () => session.isOnline(), request: (t, d) => session.request(t, d) });

  session.on('logged_in', () => {
    if (config.p2p.enabled) peerDiscovery.startBroadcast();
  });
  session.on('authenticated', () => {
    peerDiscovery.broadcastNow();
    logger.flush();
  });
  session.on('server-lost', () => {
    peerDiscovery.broadcastNow();
    // Server mất → thử đẩy tin chờ qua P2P cho các peer đang online
    for (const peer of registry.list()) p2p.onPeerAvailable(peer);
  });
  session.on('logged_out', () => {
    peerDiscovery.stopBroadcast();
    registry.clear();
    p2pNode.closeAll();
    files.abortAll();
    repos.users.setAllOffline();
  });
  registry.on('change', (list) => emit(IPC_EVENTS.PEERS, list));
  serverDiscovery.on('change', (list) => emit(IPC_EVENTS.SERVERS, list));
  const onServerAnnounce = (info) => {
    const server = session.getServer();
    // Nghe thấy đúng server của phiên hiện tại → reconnect ngay, không chờ backoff
    if (session.isLoggedIn() && !session.isOnline() && server && info.host === server.host && Number(info.port) === Number(server.port)) {
      connection.reconnectNow();
    }
  };
  serverDiscovery.on('announce', onServerAnnounce);
  peerDiscovery.on('server-announce', (data, ip) => serverDiscovery.handleAnnounce(data, ip));

  /** Khởi động các socket mạng; lỗi từng phần chỉ log (app vẫn chạy) */
  async function start() {
    const results = { serverDiscovery: false, p2pServer: false, peerDiscovery: false };
    try {
      await serverDiscovery.start();
      results.serverDiscovery = true;
    } catch (err) {
      logger.error(LOG_CATEGORY.CONNECTION, 'server_discovery_start_failed', { message: err.message });
    }
    if (config.p2p.enabled) {
      try {
        await p2pNode.start();
        results.p2pServer = true;
      } catch (err) {
        logger.error(LOG_CATEGORY.CONNECTION, 'p2p_server_start_failed', { port: config.p2p.port, message: err.message });
      }
      try {
        await peerDiscovery.start();
        results.peerDiscovery = true;
      } catch (err) {
        logger.error(LOG_CATEGORY.CONNECTION, 'peer_discovery_start_failed', { port: config.p2p.discoveryPort, message: err.message });
      }
    }
    logger.info(LOG_CATEGORY.APP, 'network_started', results);
    return results;
  }

  /** Đóng mọi socket + DB (thoát app) */
  async function stop() {
    syncClient.dispose();
    files.abortAll();
    connection.close();
    serverDiscovery.stop();
    peerDiscovery.stop();
    await p2pNode.stop().catch((err) => logger.warn(LOG_CATEGORY.APP, 'p2p_stop_failed', { message: err.message }));
    logger.stop();
    closeDatabase(db);
  }

  return {
    db,
    repos,
    instanceId,
    connection,
    session,
    view,
    clock,
    files,
    fileCache,
    registry,
    p2pNode,
    peerDiscovery,
    serverDiscovery,
    p2p,
    chat,
    inbound,
    sync,
    syncClient,
    start,
    stop,
  };
}

module.exports = { createContainer };
