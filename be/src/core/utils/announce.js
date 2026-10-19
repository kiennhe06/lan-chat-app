/**
 * Dựng gói UDP server:announce (PROTOCOL §7.1) + gửi broadcast tới mọi địa chỉ broadcast LAN.
 * Dùng chung cho discovery.js (:41234) và services/peerDiscoveryBroadcast.js (:5003).
 */
'use strict';

const C = require('../../shared/constants');
const W = require('../../shared/wsEvents');
const { broadcastTargets } = require('./network');

/**
 * @param {{ serverName: string, host: string, port: number }} info
 * @returns {Buffer}
 */
function buildServerAnnounce(info) {
  return Buffer.from(
    JSON.stringify({
      type: W.DISCOVERY.SERVER_ANNOUNCE,
      app_name: C.APP_NAME,
      server_name: info.serverName,
      host: info.host,
      port: info.port,
      version: C.APP_VERSION,
      server_online: true,
    })
  );
}

/**
 * Gửi announce tới 255.255.255.255 + broadcast của từng interface (host = IP interface tương ứng).
 * Lỗi gửi (không có mạng, interface down) chỉ báo qua onError, không throw.
 * @param {import('dgram').Socket} socket
 * @param {{ serverName: string, port: number, targetPort: number, onError: Function }} options
 */
function broadcastAnnounce(socket, options) {
  for (const target of broadcastTargets()) {
    const packet = buildServerAnnounce({ serverName: options.serverName, host: target.host, port: options.port });
    socket.send(packet, options.targetPort, target.address, (err) => {
      if (err) options.onError(err, target.address);
    });
  }
}

module.exports = { buildServerAnnounce, broadcastAnnounce };
