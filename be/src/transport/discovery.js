/**
 * UDP discovery cổng 41234 (PROTOCOL §7.1):
 *  - Broadcast server:announce mỗi 3s tới 255.255.255.255 và broadcast address của từng interface IPv4.
 *  - Nhận client:probe → trả announce unicast (host = IP local cùng subnet với client).
 * Chịu được EADDRINUSE (client trên cùng máy đã giữ cổng) / không có mạng: ghi log, vẫn broadcast từ cổng ngẫu nhiên.
 */
'use strict';

const dgram = require('dgram');
const C = require('../shared/constants');
const W = require('../shared/wsEvents');
const { safeJsonParse } = require('../shared/serializer');
const { buildServerAnnounce, broadcastAnnounce } = require('../core/utils/announce');
const { addressForPeer } = require('../core/utils/network');

const MAX_PROBE_BYTES = 2048;

/**
 * @param {{ config: object, logger: object, getPort: () => number }} deps
 */
function createDiscovery(deps) {
  const { config, logger, getPort } = deps;
  const CAT = C.LOG_CATEGORY.CONNECTION;
  const reported = new Set();
  let socket = null;
  let timer = null;

  const onSendError = (err, address) => {
    const key = `${err.code}:${address}`;
    if (reported.has(key)) return;
    reported.add(key);
    logger.warn(CAT, 'discovery_send_failed', { address, code: err.code, error: err.message });
  };

  /** Trả lời client:probe bằng announce unicast. */
  function handleMessage(msg, rinfo) {
    if (msg.length > MAX_PROBE_BYTES) return;
    const packet = safeJsonParse(msg.toString('utf8'), null);
    if (!packet || packet.type !== W.DISCOVERY.CLIENT_PROBE || packet.app_name !== C.APP_NAME) return;
    const reply = buildServerAnnounce({ serverName: config.server.name, host: addressForPeer(rinfo.address), port: getPort() });
    socket.send(reply, rinfo.port, rinfo.address, (err) => {
      if (err) onSendError(err, rinfo.address);
    });
  }

  const tick = () =>
    broadcastAnnounce(socket, {
      serverName: config.server.name,
      port: getPort(),
      targetPort: config.discovery.port,
      onError: onSendError,
    });

  function startBroadcasting() {
    socket.setBroadcast(true);
    tick();
    timer = setInterval(tick, config.discovery.intervalMs);
    timer.unref();
  }

  /** Socket chỉ để gửi (cổng ngẫu nhiên) khi không bind được cổng discovery. */
  function bindSender(resolve) {
    socket = dgram.createSocket({ type: 'udp4' });
    socket.on('error', (err) => logger.warn(CAT, 'discovery_socket_error', { code: err.code, error: err.message }));
    socket.bind(0, () => {
      try {
        startBroadcasting();
        resolve(true);
      } catch (err) {
        logger.warn(CAT, 'discovery_start_failed', { error: err.message });
        resolve(false);
      }
    });
  }

  /**
   * Bắt đầu discovery. Không bao giờ reject.
   * @returns {Promise<boolean>}
   */
  function start() {
    if (!config.discovery.enabled) return Promise.resolve(false);
    return new Promise((resolve) => {
      let bound = false;
      socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      socket.on('message', (msg, rinfo) => {
        try {
          handleMessage(msg, rinfo);
        } catch (err) {
          logger.warn(CAT, 'discovery_message_failed', { error: err.message });
        }
      });
      socket.on('error', (err) => {
        logger.warn(CAT, 'discovery_socket_error', { code: err.code, error: err.message });
        if (bound) return;
        // Bind thất bại (EADDRINUSE...) → chuyển sang chế độ chỉ broadcast
        try {
          socket.close();
        } catch (closeErr) {
          logger.warn(CAT, 'discovery_close_failed', { error: closeErr.message });
        }
        bindSender(resolve);
      });
      socket.bind(config.discovery.port, () => {
        bound = true;
        try {
          startBroadcasting();
          resolve(true);
        } catch (err) {
          logger.warn(CAT, 'discovery_start_failed', { error: err.message });
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
        logger.warn(CAT, 'discovery_close_failed', { error: err.message });
      }
    }
    socket = null;
  }

  return { start, stop };
}

module.exports = { createDiscovery };
