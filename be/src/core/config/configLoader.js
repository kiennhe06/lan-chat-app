/**
 * Nạp cấu hình runtime theo thứ tự ưu tiên (cao → thấp):
 *   options.overrides (startServer trong test) → biến môi trường → app-config.json → server.config.js
 *
 * - app-config.json nằm cạnh index.js; thiếu → tự sinh từ mặc định (chỉ các khóa người dùng nên sửa).
 * - Deep-merge object, mảng thay thế nguyên.
 * - Validate cuối cùng: sai → throw Error có thông báo rõ (không chạy với cấu hình hỏng).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const C = require('../../shared/constants');
const defaults = require('./server.config.js');
const pathsModule = require('./paths');

/** Nội dung app-config.json sinh tự động (gọn, đủ để chỉnh tay). */
function defaultFileConfig() {
  return {
    dataDir: null,
    server: { ...defaults.server },
    discovery: { ...defaults.discovery },
    p2p: { discoveryPort: defaults.p2p.discoveryPort, broadcastEnabled: defaults.p2p.broadcastEnabled },
    logging: {
      level: defaults.logging.level,
      consoleLevel: defaults.logging.consoleLevel,
      retentionDays: defaults.logging.retentionDays,
      logMessageContent: defaults.logging.logMessageContent,
    },
  };
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Deep-merge (không mutate). Giá trị undefined ở source bị bỏ qua.
 * @param {object} target
 * @param {object} source
 */
function deepMerge(target, source) {
  const out = { ...target };
  for (const [key, value] of Object.entries(source || {})) {
    if (value === undefined) continue;
    out[key] = isPlainObject(value) && isPlainObject(out[key]) ? deepMerge(out[key], value) : value;
  }
  return out;
}

const parseBool = (raw) => {
  if (raw === undefined) return undefined;
  return ['1', 'true', 'yes', 'on'].includes(String(raw).trim().toLowerCase());
};
const parseIntOrUndef = (raw) => (raw === undefined || raw === '' ? undefined : Number(raw));

/**
 * Đọc override từ biến môi trường.
 * @param {NodeJS.ProcessEnv} env
 */
function envOverrides(env) {
  return {
    dataDir: env.LANCHAT_DATA_DIR || undefined,
    server: {
      host: env.LANCHAT_HOST || undefined,
      port: parseIntOrUndef(env.LANCHAT_PORT),
      name: env.LANCHAT_SERVER_NAME || undefined,
    },
    discovery: {
      enabled: parseBool(env.LANCHAT_DISCOVERY_ENABLED),
      port: parseIntOrUndef(env.LANCHAT_DISCOVERY_PORT),
    },
    p2p: {
      discoveryPort: parseIntOrUndef(env.LANCHAT_P2P_DISCOVERY_PORT),
      broadcastEnabled: parseBool(env.LANCHAT_P2P_BROADCAST),
    },
    logging: {
      level: env.LANCHAT_LOG_LEVEL || undefined,
      consoleLevel: env.LANCHAT_LOG_CONSOLE_LEVEL || undefined,
      logMessageContent: parseBool(env.LANCHAT_LOG_MESSAGE_CONTENT),
    },
  };
}

/**
 * Đọc app-config.json; thiếu thì tạo mới. JSON hỏng → throw (không ghi đè file của người dùng).
 * @param {string} file
 * @param {boolean} writeIfMissing
 * @returns {{ data: object, created: boolean }}
 */
function readOrCreateConfigFile(file, writeIfMissing) {
  if (!fs.existsSync(file)) {
    const data = defaultFileConfig();
    if (writeIfMissing) {
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
      } catch (err) {
        throw new Error(`Không tạo được file cấu hình ${file}: ${err.message}`);
      }
    }
    return { data, created: writeIfMissing };
  }
  let text;
  try {
    text = fs.readFileSync(file, 'utf8').replace(/^﻿/, ''); // bỏ BOM nếu sửa bằng Notepad
  } catch (err) {
    throw new Error(`Không đọc được file cấu hình ${file}: ${err.message}`);
  }
  try {
    const data = JSON.parse(text);
    if (!isPlainObject(data)) throw new Error('nội dung phải là object JSON');
    return { data, created: false };
  } catch (err) {
    throw new Error(`File cấu hình ${file} không hợp lệ: ${err.message}`);
  }
}

const isPort = (v, allowZero) => Number.isInteger(v) && v >= (allowZero ? 0 : 1) && v <= 65535;
const LOG_LEVELS = Object.values(C.LOG_LEVEL);

/**
 * Validate cấu hình đã merge. Ném Error liệt kê toàn bộ lỗi.
 * @param {object} cfg
 */
function validateConfig(cfg) {
  const errors = [];
  if (!isPort(cfg.server.port, true)) errors.push('server.port phải là số nguyên 0–65535');
  if (typeof cfg.server.host !== 'string' || !cfg.server.host) errors.push('server.host không hợp lệ');
  if (typeof cfg.server.name !== 'string' || !cfg.server.name.trim()) errors.push('server.name không được rỗng');
  if (!isPort(cfg.discovery.port, true)) errors.push('discovery.port phải là số nguyên 0–65535');
  if (!(Number(cfg.discovery.intervalMs) >= 500)) errors.push('discovery.intervalMs phải ≥ 500');
  if (!isPort(cfg.p2p.discoveryPort, true)) errors.push('p2p.discoveryPort phải là số nguyên 0–65535');
  if (!LOG_LEVELS.includes(cfg.logging.level)) errors.push(`logging.level phải thuộc ${LOG_LEVELS.join('|')}`);
  if (![...LOG_LEVELS, 'none'].includes(cfg.logging.consoleLevel)) {
    errors.push(`logging.consoleLevel phải thuộc ${LOG_LEVELS.join('|')}|none`);
  }
  if (!(Number.isInteger(cfg.logging.retentionDays) && cfg.logging.retentionDays >= 1)) {
    errors.push('logging.retentionDays phải là số nguyên ≥ 1');
  }
  if (!(Number.isInteger(cfg.auth.bcryptRounds) && cfg.auth.bcryptRounds >= 4)) {
    errors.push('auth.bcryptRounds phải là số nguyên ≥ 4');
  }
  if (cfg.dataDir != null && typeof cfg.dataDir !== 'string') errors.push('dataDir phải là chuỗi hoặc null');
  if (errors.length) throw new Error(`Cấu hình không hợp lệ:\n - ${errors.join('\n - ')}`);
}

/**
 * Nạp cấu hình + dựng paths.
 * @param {{ baseDir?: string, env?: NodeJS.ProcessEnv, overrides?: object, writeIfMissing?: boolean }} [options]
 * @returns {{ config: object, paths: object, configFile: string, configCreated: boolean }}
 */
function loadConfig(options) {
  const opts = options || {};
  const baseDir = opts.baseDir || pathsModule.DEFAULT_BASE_DIR;
  const configFile = path.join(baseDir, pathsModule.CONFIG_FILE_NAME);
  const { data, created } = readOrCreateConfigFile(configFile, opts.writeIfMissing !== false);

  let merged = deepMerge({ dataDir: null, ...defaults }, data);
  merged = deepMerge(merged, envOverrides(opts.env || process.env));
  merged = deepMerge(merged, opts.overrides || {});
  validateConfig(merged);

  const paths = pathsModule.buildPaths({ baseDir, dataDir: merged.dataDir });
  return { config: merged, paths, configFile, configCreated: created };
}

module.exports = { loadConfig, deepMerge, validateConfig, defaultFileConfig };
