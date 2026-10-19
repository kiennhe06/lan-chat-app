/**
 * Lắng nghe server:announce (UDP :41234, và chuyển tiếp từ :5003) → danh sách server trong LAN (evt:servers).
 * Gửi client:probe broadcast để server trả lời unicast ngay.
 * Nếu cổng 41234 đã bị chiếm (vd: server chạy cùng máy không bật reuseAddr) → bind cổng ngẫu nhiên,
 * vẫn probe được (server trả unicast về cổng nguồn).
 */
'use strict';

const dgram = require('dgram');
const { EventEmitter } = require('events');
const { APP_NAME, NETWORK, LOG_CATEGORY } = require('../../../shared/constants');
const { DISCOVERY } = require('../../../shared/wsEvents');
const { listIpv4Interfaces, broadcastAddresses, normalizeRemoteAddress } = require('../../core/utils/net');

const MAX_PACKET = 4096;

class ServerDiscovery extends EventEmitter {
  /**
   * @param {{ port?: number, logger: object }} opts
   */
  constructor(opts) {
    super();
    this.port = opts.port || NETWORK.SERVER_DISCOVERY_PORT;
    this.log = opts.logger;
    this.servers = new Map(); // "host:port" → info
    this.socket = null;
    this.pruneTimer = null;
  }

  /** @returns {Promise<void>} */
  start() {
    return this._bind(this.port).catch((err) => {
      this.log.warn(LOG_CATEGORY.CONNECTION, 'server_discovery_bind_fallback', { port: this.port, message: err.message });
      return this._bind(0);
    }).then(() => {
      this.pruneTimer = setInterval(() => this._prune(), NETWORK.SERVER_BROADCAST_INTERVAL_MS);
      if (this.pruneTimer.unref) this.pruneTimer.unref();
      this.probe();
    });
  }

  _bind(port) {
    return new Promise((resolve, reject) => {
      const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      const onError = (err) => {
        socket.close();
        reject(err);
      };
      socket.once('error', onError);
      socket.bind(port, () => {
        socket.removeListener('error', onError);
        try {
          socket.setBroadcast(true);
        } catch (err) {
          this.log.warn(LOG_CATEGORY.CONNECTION, 'set_broadcast_failed', { message: err.message });
        }
        socket.on('error', (err) => this.log.warn(LOG_CATEGORY.CONNECTION, 'server_discovery_error', { message: err.message }));
        socket.on('message', (msg, rinfo) => this._onPacket(msg, rinfo));
        this.socket = socket;
        resolve();
      });
    });
  }

  _onPacket(msg, rinfo) {
    if (msg.length > MAX_PACKET) return;
    let data;
    try {
      data = JSON.parse(msg.toString('utf8'));
    } catch (_err) {
      return;
    }
    if (data && data.type === DISCOVERY.SERVER_ANNOUNCE) this.handleAnnounce(data, rinfo.address);
  }

  /**
   * Xử lý 1 gói server:announce (cũng được peerDiscovery gọi khi nhận trên :5003).
   * @param {object} data
   * @param {string} fromAddress
   */
  handleAnnounce(data, fromAddress) {
    if (!data || data.app_name !== APP_NAME) return;
    const host = String(data.host || normalizeRemoteAddress(fromAddress));
    const port = Number(data.port) || NETWORK.SERVER_PORT;
    const key = `${host}:${port}`;
    const isNew = !this.servers.has(key);
    const info = {
      host,
      port,
      server_name: String(data.server_name || 'LANChat Server'),
      version: String(data.version || ''),
      last_seen: new Date().toISOString(),
    };
    this.servers.set(key, { ...info, seenAt: Date.now() });
    if (isNew) this._emitChange();
    this.emit('announce', info);
  }

  _prune() {
    const cutoff = Date.now() - NETWORK.SERVER_STALE_MS;
    let changed = false;
    for (const [key, s] of this.servers) {
      if (s.seenAt < cutoff) {
        this.servers.delete(key);
        changed = true;
      }
    }
    if (changed) this._emitChange();
  }

  _emitChange() {
    this.emit('change', this.list());
  }

  /** @returns {Array<{host, port, server_name, version, last_seen}>} */
  list() {
    return Array.from(this.servers.values()).map(({ seenAt, ...rest }) => rest);
  }

  /** Gửi client:probe tới mọi địa chỉ broadcast */
  probe() {
    if (!this.socket) return;
    const packet = Buffer.from(JSON.stringify({ type: DISCOVERY.CLIENT_PROBE, app_name: APP_NAME }));
    for (const addr of broadcastAddresses(listIpv4Interfaces())) {
      this.socket.send(packet, this.port, addr, (err) => {
        if (err) this.log.debug(LOG_CATEGORY.CONNECTION, 'probe_send_failed', { addr, message: err.message });
      });
    }
  }

  stop() {
    if (this.pruneTimer) clearInterval(this.pruneTimer);
    this.pruneTimer = null;
    if (this.socket) {
      try {
        this.socket.close();
      } catch (_err) {
        /* đã đóng */
      }
    }
    this.socket = null;
  }
}

module.exports = { ServerDiscovery };
