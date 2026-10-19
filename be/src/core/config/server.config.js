/**
 * Cấu hình MẶC ĐỊNH của server (giá trị thấp nhất trong thứ tự ưu tiên).
 * Thứ tự merge: biến môi trường → app-config.json → file này (xem configLoader.js).
 */
'use strict';

const C = require('../../shared/constants');
const loggingConfig = require('./logging.config.js');

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const serverConfig = Object.freeze({
  server: {
    host: '0.0.0.0', // lắng nghe mọi interface LAN
    port: C.NETWORK.SERVER_PORT, // HTTP + WebSocket
    name: `${C.APP_NAME} Server`,
  },
  discovery: {
    enabled: true,
    port: C.NETWORK.SERVER_DISCOVERY_PORT, // UDP server:announce / client:probe
    intervalMs: C.NETWORK.SERVER_BROADCAST_INTERVAL_MS,
  },
  p2p: {
    // Server không chạy P2P, chỉ broadcast server:announce lên cổng peer discovery để client biết server sống
    port: C.NETWORK.P2P_PORT,
    discoveryPort: C.NETWORK.P2P_DISCOVERY_PORT,
    broadcastEnabled: true,
  },
  upload: {
    maxFileSize: C.MAX_FILE_SIZE,
    maxAvatarSize: C.MAX_AVATAR_SIZE,
  },
  auth: {
    bcryptRounds: 10,
    sessionTtlMs: C.SESSION_TTL_MS,
    authTimeoutMs: 10000, // frame đầu tiên phải là auth trong 10s
    tokenRenewThresholdMs: ONE_DAY_MS, // reconnect: token còn < 1 ngày → cấp mới
  },
  ws: {
    heartbeatIntervalMs: C.NETWORK.HEARTBEAT_INTERVAL_MS,
    maxPayloadBytes: 16 * 1024 * 1024,
  },
  sync: {
    maxMessagesPerResponse: 2000,
    maxMessageBatch: 100,
    maxActionBatch: 100,
    maxFileBatch: 500,
    maxLogBatch: 500,
  },
  logging: loggingConfig,
});

module.exports = serverConfig;
