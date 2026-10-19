/**
 * UDP :5003 — broadcast peer:announce mỗi 5s (khi đã đăng nhập) + lắng nghe announce của peer khác
 * và server:announce (server cũng phát lên :5003 để client biết server sống).
 * Bind với reuseAddr để nhiều client trên cùng máy (test) cùng nghe được.
 */
'use strict';

const dgram = require('dgram');
const { EventEmitter } = require('events');
const { APP_NAME, NETWORK, LOG_CATEGORY } = require('../../../shared/constants');
const { DISCOVERY } = require('../../../shared/wsEvents');
const { listIpv4Interfaces, broadcastAddresses, normalizeRemoteAddress } = require('../../core/utils/net');

const MAX_PACKET = 4096;

class PeerDiscovery extends EventEmitter {
  /**
   * @param {{ port?: number, intervalMs?: number, instanceId: string, registry: import('./peerRegistry').PeerRegistry,
   *   getAnnounce: () => ({user_id, display_name, peer_port, server_online} | null), logger: object }} opts
   */
  constructor(opts) {
    super();
    this.port = opts.port || NETWORK.P2P_DISCOVERY_PORT;
    this.intervalMs = opts.intervalMs || NETWORK.PEER_BROADCAST_INTERVAL_MS;
    this.instanceId = opts.instanceId;
    this.registry = opts.registry;
    this.getAnnounce = opts.getAnnounce;
    this.log = opts.logger;
    this.socket = null;
    this.timer = null;
  }

  /** Bind socket lắng nghe (gọi 1 lần lúc khởi động) */
  start() {
    return new Promise((resolve, reject) => {
      const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      const onError = (err) => {
        socket.close();
        reject(err);
      };
      socket.once('error', onError);
      socket.bind(this.port, () => {
        socket.removeListener('error', onError);
        try {
          socket.setBroadcast(true);
        } catch (err) {
          this.log.warn(LOG_CATEGORY.CONNECTION, 'set_broadcast_failed', { message: err.message });
        }
        socket.on('error', (err) => this.log.warn(LOG_CATEGORY.CONNECTION, 'peer_discovery_error', { message: err.message }));
        socket.on('message', (msg, rinfo) => this._onPacket(msg, rinfo));
        this.socket = socket;
        this.registry.start();
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
    if (!data || data.app_name !== APP_NAME) return;
    const ip = normalizeRemoteAddress(rinfo.address);
    if (data.type === DISCOVERY.PEER_ANNOUNCE) {
      if (data.instance_id === this.instanceId) return; // gói của chính mình
      this.registry.seen(data, ip);
    } else if (data.type === DISCOVERY.SERVER_ANNOUNCE) {
      this.emit('server-announce', data, ip);
    }
  }

  /** Bắt đầu broadcast định kỳ (sau khi đăng nhập) */
  startBroadcast() {
    if (this.timer || !this.socket) return;
    this.broadcastNow();
    this.timer = setInterval(() => this.broadcastNow(), this.intervalMs);
    if (this.timer.unref) this.timer.unref();
  }

  /** Dừng broadcast (logout) */
  stopBroadcast() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Gửi 1 gói announce ngay (vd: khi trạng thái server thay đổi) */
  broadcastNow() {
    if (!this.socket) return;
    const info = this.getAnnounce();
    if (!info) return;
    const packet = Buffer.from(
      JSON.stringify({ type: DISCOVERY.PEER_ANNOUNCE, app_name: APP_NAME, instance_id: this.instanceId, ...info }),
    );
    for (const addr of broadcastAddresses(listIpv4Interfaces())) {
      this.socket.send(packet, this.port, addr, (err) => {
        if (err) this.log.debug(LOG_CATEGORY.CONNECTION, 'peer_announce_failed', { addr, message: err.message });
      });
    }
  }

  stop() {
    this.stopBroadcast();
    this.registry.stop();
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

module.exports = { PeerDiscovery };
