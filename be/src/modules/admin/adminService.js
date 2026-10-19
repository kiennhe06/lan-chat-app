/**
 * Quản trị (chỉ manager): danh sách / chặn / bỏ chặn IP.
 * Chặn IP → kick ngay mọi socket từ IP đó (auth:kicked) và HTTP trả 403.
 * Danh sách IP bị chặn được cache trong RAM để kiểm tra nhanh mỗi request.
 */
'use strict';

const C = require('../../shared/constants');
const V = require('../../shared/validators');
const { errors } = require('../../core/errors');
const { isLoopback, normalizeIp } = require('../../core/utils/network');

const RESERVED_IPS = new Set(['0.0.0.0', '255.255.255.255']);

/**
 * @param {{ repos: object, hub: object, logger: object }} deps
 */
function createAdminService(deps) {
  const { repos, hub, logger } = deps;
  const blocked = new Set(repos.blockedIps.list().map((r) => r.ip));

  /** @param {{ role: string }} user */
  function requireManager(user) {
    if (!user || user.role !== C.USER_ROLE.MANAGER) throw errors.forbidden('Chỉ quản lý (manager) được thực hiện');
  }

  /** IP có bị chặn không (dùng cho mọi kết nối WS + HTTP). */
  const isBlocked = (ip) => blocked.has(normalizeIp(ip));

  const toWire = (row) => ({ ip: row.ip, reason: row.reason || '', blocked_by: row.blocked_by, created_at: row.created_at });

  function list(user) {
    requireManager(user);
    return { blocked: repos.blockedIps.list().map(toWire) };
  }

  /**
   * Chặn IP. Không cho chặn loopback hoặc chính IP của người thao tác.
   * @returns {{ blocked: object, kicked_count: number }}
   */
  function block(user, input, requesterIp) {
    requireManager(user);
    const ipResult = V.validateIpv4(input && input.ip);
    if (!ipResult.ok) throw errors.validation(ipResult.error);
    const ip = ipResult.value;
    if (isLoopback(ip) || RESERVED_IPS.has(ip)) throw errors.validation('Không thể chặn địa chỉ IP này (127.0.0.1 / địa chỉ đặc biệt)');
    if (ip === normalizeIp(requesterIp)) throw errors.validation('Không thể chặn địa chỉ IP của chính bạn');
    const reason = String((input && input.reason) || '').trim().slice(0, C.BLOCK_REASON_MAX);
    repos.blockedIps.upsert({ ip, reason, blocked_by: user.id, created_at: new Date().toISOString() });
    blocked.add(ip);
    const kicked = hub.kickIp(ip, C.MESSAGES_VI.BLOCKED);
    logger.logAudit(C.LOG_LEVEL.AUDIT, C.LOG_CATEGORY.SETTINGS, 'ip_blocked', user.id, { target_ip: ip, reason, kicked }, requesterIp);
    return { blocked: toWire(repos.blockedIps.find(ip)), kicked_count: kicked };
  }

  function unblock(user, input, requesterIp) {
    requireManager(user);
    const ipResult = V.validateIpv4(input && input.ip);
    if (!ipResult.ok) throw errors.validation(ipResult.error);
    const ip = ipResult.value;
    if (!repos.blockedIps.remove(ip)) throw errors.notFound('IP này không nằm trong danh sách chặn');
    blocked.delete(ip);
    logger.logAudit(C.LOG_LEVEL.AUDIT, C.LOG_CATEGORY.SETTINGS, 'ip_unblocked', user.id, { target_ip: ip }, requesterIp);
    return { ip };
  }

  return { requireManager, isBlocked, list, block, unblock };
}

module.exports = { createAdminService };
