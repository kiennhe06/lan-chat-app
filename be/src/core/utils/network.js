/**
 * Tiện ích mạng LAN (pure-ish, chỉ đọc os.networkInterfaces): chuẩn hóa IP, liệt kê interface IPv4,
 * tính địa chỉ broadcast, chọn địa chỉ host phù hợp để quảng bá.
 */
'use strict';

const os = require('os');

const LOOPBACK_V4 = '127.0.0.1';
const LIMITED_BROADCAST = '255.255.255.255';

/**
 * Chuẩn hóa IP từ socket: "::ffff:192.168.1.5" → "192.168.1.5", "::1" → "127.0.0.1".
 * @param {string|undefined} raw
 */
function normalizeIp(raw) {
  if (!raw) return '';
  if (raw === '::1') return LOOPBACK_V4;
  if (raw.startsWith('::ffff:')) return raw.slice(7);
  return raw;
}

const isLoopback = (ip) => /^127\./.test(ip);

const ipToInt = (ip) => ip.split('.').reduce((acc, part) => ((acc << 8) + Number(part)) >>> 0, 0);
const intToIp = (n) => [24, 16, 8, 0].map((shift) => (n >>> shift) & 255).join('.');

/**
 * Danh sách interface IPv4 không phải loopback.
 * @returns {{ name: string, address: string, netmask: string, broadcast: string }[]}
 */
function listIpv4Interfaces() {
  const result = [];
  const ifaces = os.networkInterfaces();
  for (const [name, entries] of Object.entries(ifaces)) {
    for (const entry of entries || []) {
      const isV4 = entry.family === 'IPv4' || entry.family === 4;
      if (!isV4 || entry.internal) continue;
      // broadcast = ip | ~mask
      const broadcast = intToIp((ipToInt(entry.address) | ~ipToInt(entry.netmask)) >>> 0);
      result.push({ name, address: entry.address, netmask: entry.netmask, broadcast });
    }
  }
  return result;
}

/** Tất cả địa chỉ broadcast cần gửi (255.255.255.255 + từng interface), không trùng. */
function broadcastTargets() {
  const targets = [{ address: LIMITED_BROADCAST, host: primaryAddress() }];
  for (const iface of listIpv4Interfaces()) {
    if (!targets.some((t) => t.address === iface.broadcast)) {
      targets.push({ address: iface.broadcast, host: iface.address });
    }
  }
  return targets;
}

/** IPv4 LAN chính (interface đầu tiên), fallback loopback. */
function primaryAddress() {
  const first = listIpv4Interfaces()[0];
  return first ? first.address : LOOPBACK_V4;
}

/**
 * Chọn địa chỉ local cùng subnet với IP người hỏi (trả lời client:probe), fallback primary.
 * @param {string} remoteIp
 */
function addressForPeer(remoteIp) {
  const remote = ipToInt(normalizeIp(remoteIp) || LOOPBACK_V4);
  const match = listIpv4Interfaces().find((i) => (ipToInt(i.address) & ipToInt(i.netmask)) === (remote & ipToInt(i.netmask)));
  return match ? match.address : primaryAddress();
}

module.exports = {
  LOOPBACK_V4,
  LIMITED_BROADCAST,
  normalizeIp,
  isLoopback,
  listIpv4Interfaces,
  broadcastTargets,
  primaryAddress,
  addressForPeer,
};
