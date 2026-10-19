/**
 * Bảng peer đang online trong LAN (từ UDP peer:announce). Peer miss 3 lần broadcast (15s) → xóa.
 * Phát 'change' (danh sách cho evt:peers), 'peer-added', 'peer-removed', 'peer-updated'. Lưu peers_cache.
 */
'use strict';

const { EventEmitter } = require('events');
const { NETWORK } = require('../../../shared/constants');

class PeerRegistry extends EventEmitter {
  /**
   * @param {{ peersRepo?: object, intervalMs?: number, missLimit?: number, now?: () => number, logger?: object }} [opts]
   */
  constructor(opts) {
    super();
    const o = opts || {};
    this.peersRepo = o.peersRepo || null;
    this.intervalMs = o.intervalMs || NETWORK.PEER_BROADCAST_INTERVAL_MS;
    this.missLimit = o.missLimit || NETWORK.PEER_MISS_LIMIT;
    this.now = o.now || Date.now;
    this.log = o.logger;
    this.peers = new Map(); // instance_id → peer
    this.timer = null;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.prune(), this.intervalMs);
    if (this.timer.unref) this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Ghi nhận 1 gói announce.
   * @param {{instance_id, user_id, display_name, peer_port, server_online}} a
   * @param {string} ip
   */
  seen(a, ip) {
    const instanceId = String(a.instance_id || '');
    const userId = Number(a.user_id);
    if (!instanceId || !Number.isInteger(userId)) return null;
    const existing = this.peers.get(instanceId);
    const peer = {
      instance_id: instanceId,
      user_id: userId,
      display_name: String(a.display_name || ''),
      ip,
      port: Number(a.peer_port) || NETWORK.P2P_PORT,
      server_online: !!a.server_online,
      last_seen: new Date(this.now()).toISOString(),
      seenAt: this.now(),
    };
    this.peers.set(instanceId, peer);
    const changed =
      !existing || existing.ip !== peer.ip || existing.port !== peer.port || existing.server_online !== peer.server_online ||
      existing.user_id !== peer.user_id || existing.display_name !== peer.display_name;
    if (changed && this.peersRepo) {
      try {
        this.peersRepo.upsert(peer);
      } catch (err) {
        if (this.log) this.log.warn('connection', 'peers_cache_write_failed', { message: err.message });
      }
    }
    if (!existing) this.emit('peer-added', this.publicPeer(peer));
    else if (changed) this.emit('peer-updated', this.publicPeer(peer));
    if (changed) this.emit('change', this.list());
    return peer;
  }

  /** Xóa peer quá 3 chu kỳ không thấy */
  prune() {
    const cutoff = this.now() - this.intervalMs * this.missLimit;
    let changed = false;
    for (const [id, p] of this.peers) {
      if (p.seenAt < cutoff) {
        this.peers.delete(id);
        changed = true;
        this.emit('peer-removed', this.publicPeer(p));
      }
    }
    if (changed) this.emit('change', this.list());
  }

  /** Xóa toàn bộ (logout) */
  clear() {
    if (!this.peers.size) return;
    this.peers.clear();
    this.emit('change', []);
  }

  publicPeer(p) {
    const { seenAt, ...rest } = p;
    return rest;
  }

  /** Danh sách cho evt:peers */
  list() {
    return Array.from(this.peers.values()).map((p) => this.publicPeer(p));
  }

  /** Mọi instance đang online của 1 user (1 user có thể đăng nhập nhiều máy) */
  getByUserId(userId) {
    return this.list().filter((p) => p.user_id === Number(userId));
  }

  get(instanceId) {
    const p = this.peers.get(instanceId);
    return p ? this.publicPeer(p) : null;
  }

  isUserOnline(userId) {
    return this.getByUserId(userId).length > 0;
  }
}

module.exports = { PeerRegistry };
