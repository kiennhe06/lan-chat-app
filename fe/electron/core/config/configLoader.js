/**
 * Nạp cấu hình client. Thứ tự ưu tiên: biến môi trường → app-config.json (cạnh .exe) → mặc định.
 * File app-config.json được tự sinh nếu chưa có. JSON hỏng → dùng mặc định, KHÔNG ghi đè file của người dùng.
 */
'use strict';

const fs = require('fs');
const { NETWORK, LOG_LEVEL, LOG_LEVEL_RANK } = require('../../../shared/constants');

const MB = 1024 * 1024;

/** Cấu hình mặc định (đặt tên field rõ để người quản trị sửa tay được) */
const DEFAULT_CONFIG = Object.freeze({
  server: {
    // Để trống → người dùng chọn từ danh sách discovery hoặc nhập IP
    host: '',
    port: NETWORK.SERVER_PORT,
  },
  network: {
    serverDiscoveryPort: NETWORK.SERVER_DISCOVERY_PORT,
    requestTimeoutMs: NETWORK.REQUEST_TIMEOUT_MS,
    reconnectMinMs: NETWORK.RECONNECT_MIN_MS,
    reconnectMaxMs: NETWORK.RECONNECT_MAX_MS,
  },
  p2p: {
    enabled: true,
    port: NETWORK.P2P_PORT,
    discoveryPort: NETWORK.P2P_DISCOVERY_PORT,
    broadcastIntervalMs: NETWORK.PEER_BROADCAST_INTERVAL_MS,
  },
  logging: {
    level: LOG_LEVEL.INFO,
    logMessageContent: false,
    retentionDays: 30,
    maxFileSizeMb: 10,
    shipToServer: true,
  },
  notifications: {
    enabled: true,
  },
});

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Deep merge (không mutate input). Mảng/primitive ở `override` thay thế hoàn toàn.
 * @param {object} base
 * @param {object} override
 * @returns {object}
 */
function deepMerge(base, override) {
  const out = { ...base };
  for (const [key, value] of Object.entries(override || {})) {
    out[key] = isPlainObject(value) && isPlainObject(base[key]) ? deepMerge(base[key], value) : value;
  }
  return out;
}

const toInt = (v) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

/**
 * Đọc override từ env (chỉ những key được hỗ trợ).
 * @param {NodeJS.ProcessEnv} env
 */
function envOverrides(env) {
  const o = { server: {}, network: {}, p2p: {}, logging: {}, notifications: {} };
  if (env.LANCHAT_SERVER_HOST) o.server.host = env.LANCHAT_SERVER_HOST.trim();
  if (toInt(env.LANCHAT_SERVER_PORT)) o.server.port = toInt(env.LANCHAT_SERVER_PORT);
  if (toInt(env.LANCHAT_SERVER_DISCOVERY_PORT)) o.network.serverDiscoveryPort = toInt(env.LANCHAT_SERVER_DISCOVERY_PORT);
  if (toInt(env.LANCHAT_P2P_PORT)) o.p2p.port = toInt(env.LANCHAT_P2P_PORT);
  if (toInt(env.LANCHAT_P2P_DISCOVERY_PORT)) o.p2p.discoveryPort = toInt(env.LANCHAT_P2P_DISCOVERY_PORT);
  if (env.LANCHAT_P2P_ENABLED) o.p2p.enabled = env.LANCHAT_P2P_ENABLED !== 'false';
  if (env.LANCHAT_LOG_LEVEL && LOG_LEVEL_RANK[env.LANCHAT_LOG_LEVEL] !== undefined) o.logging.level = env.LANCHAT_LOG_LEVEL;
  if (env.LANCHAT_NOTIFICATIONS) o.notifications.enabled = env.LANCHAT_NOTIFICATIONS !== 'false';
  return o;
}

/**
 * Nạp cấu hình.
 * @param {{ configFile: string, env?: NodeJS.ProcessEnv, fsImpl?: typeof fs }} opts
 * @returns {{ config: typeof DEFAULT_CONFIG, warnings: string[], created: boolean }}
 */
function loadConfig(opts) {
  const fsx = opts.fsImpl || fs;
  const env = opts.env || process.env;
  const warnings = [];
  let fileConfig = {};
  let created = false;

  if (fsx.existsSync(opts.configFile)) {
    try {
      fileConfig = JSON.parse(fsx.readFileSync(opts.configFile, 'utf8'));
      if (!isPlainObject(fileConfig)) throw new Error('root không phải object');
    } catch (err) {
      warnings.push(`app-config.json không hợp lệ (${err.message}) — dùng cấu hình mặc định`);
      fileConfig = {};
    }
  } else {
    try {
      fsx.writeFileSync(opts.configFile, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`, 'utf8');
      created = true;
    } catch (err) {
      warnings.push(`Không tạo được app-config.json: ${err.message}`);
    }
  }

  const config = deepMerge(deepMerge(DEFAULT_CONFIG, fileConfig), envOverrides(env));
  if (LOG_LEVEL_RANK[config.logging.level] === undefined) {
    warnings.push(`logging.level "${config.logging.level}" không hợp lệ — dùng "info"`);
    config.logging = { ...config.logging, level: LOG_LEVEL.INFO };
  }
  config.logging.maxFileSizeBytes = Math.max(1, Number(config.logging.maxFileSizeMb) || 10) * MB;
  return { config, warnings, created };
}

module.exports = { loadConfig, deepMerge, DEFAULT_CONFIG };
