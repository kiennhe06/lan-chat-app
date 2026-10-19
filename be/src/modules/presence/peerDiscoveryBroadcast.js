/**
 * Server broadcast server:announce lên cổng peer discovery (:5003) để client đang ở chế độ P2P
 * biết server đã sống lại (PROTOCOL §7.2). Socket gửi bind cổng ngẫu nhiên → không tranh cổng 5003 với client.
 */
'use strict';

const dgram = require('dgram');
const C = require('../../shared/constants');
const { broadcastAnnounce } = require('../../core/utils/announce');

/**
 * @param {{ config: object, logger: object, getPort: () => number }} deps
 */
function createPeerDiscoveryBroadcast(deps) {
  const { config, logger, getPort } = deps;
  const reported = new Set(); // chỉ log mỗi loại lỗi 1 lần (tránh spam log khi mất mạng)
  let socket = null;
  let timer = null;

  const onSendError = (err, address) => {
    const key = `${err.code}:${address}`;
    if (reported.has(key)) return;
    reported.add(key);
    logger.warn(C.LOG_CATEGORY.APP, 'peer_broadcast_send_failed', { address, code: err.code, error: err.message });
  };

  const tick = () =>
    broadcastAnnounce(socket, {
      serverName: config.server.name,
      port: getPort(),
      targetPort: config.p2p.discoveryPort,
      onError: onSendError,
    });

  /** Bắt đầu broadcast. Lỗi bind/socket chỉ ghi log — không làm sập server. */
  function start() {
    if (!config.p2p.broadcastEnabled) return Promise.resolve(false);
    return new Promise((resolve) => {
      socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      socket.on('error', (err) => {
        logger.warn(C.LOG_CATEGORY.APP, 'peer_broadcast_socket_error', { code: err.code, error: err.message });
        resolve(false);
      });
      socket.bind(0, () => {
        try {
          socket.setBroadcast(true);
          tick();
          timer = setInterval(tick, config.discovery.intervalMs);
          timer.unref();
          resolve(true);
        } catch (err) {
          logger.warn(C.LOG_CATEGORY.APP, 'peer_broadcast_start_failed', { error: err.message });
          resolve(false);
        }
      });
    });
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
    if (socket) {
      try {
        socket.close();
      } catch (err) {
        logger.warn(C.LOG_CATEGORY.APP, 'peer_broadcast_close_failed', { error: err.message });
      }
    }
    socket = null;
  }

  return { start, stop };
}

module.exports = { createPeerDiscoveryBroadcast };
