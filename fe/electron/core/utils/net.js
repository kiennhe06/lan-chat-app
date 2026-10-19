/**
 * Tiện ích mạng: liệt kê interface IPv4, kiểm tra cùng subnet, tính địa chỉ broadcast.
 * Pure (nhận danh sách interface làm tham số) để test được.
 */
'use strict';

const os = require('os');

/**
 * @typedef {{ address: string, netmask: string, name?: string }} Ipv4Iface
 */

/**
 * Danh sách interface IPv4 không phải loopback.
 * @param {() => NodeJS.Dict<os.NetworkInterfaceInfo[]>} [getIfaces]
 * @returns {Ipv4Iface[]}
 */
function listIpv4Interfaces(getIfaces) {
  const all = (getIfaces || os.networkInterfaces)();
  const out = [];
  for (const [name, entries] of Object.entries(all || {})) {
    for (const e of entries || []) {
      const isV4 = e.family === 'IPv4' || e.family === 4;
      if (isV4 && !e.internal && e.address && e.netmask) out.push({ name, address: e.address, netmask: e.netmask });
    }
  }
  return out;
}

/** "a.b.c.d" → uint32 (null nếu sai định dạng) */
function ipToInt(ip) {
  const parts = String(ip).split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const v = Number(p);
    if (!/^\d{1,3}$/.test(p) || v > 255) return null;
    n = n * 256 + v;
  }
  return n >>> 0;
}

const intToIp = (n) => [24, 16, 8, 0].map((s) => (n >>> s) & 255).join('.');

/** Bỏ tiền tố IPv4-mapped IPv6 ("::ffff:192.168.1.5" → "192.168.1.5") */
function normalizeRemoteAddress(addr) {
  const s = String(addr || '');
  return s.startsWith('::ffff:') ? s.slice(7) : s;
}

function isLoopback(addr) {
  const a = normalizeRemoteAddress(addr);
  return a === '::1' || a.startsWith('127.');
}

/**
 * IP có cùng subnet với interface không (so theo netmask).
 * @param {string} ip
 * @param {Ipv4Iface} iface
 */
function isSameSubnet(ip, iface) {
  const a = ipToInt(normalizeRemoteAddress(ip));
  const b = ipToInt(iface.address);
  const m = ipToInt(iface.netmask);
  if (a === null || b === null || m === null) return false;
  return ((a & m) >>> 0) === ((b & m) >>> 0);
}

/**
 * Chỉ chấp nhận peer cùng subnet với một interface local hoặc loopback.
 * @param {string} remoteAddress
 * @param {Ipv4Iface[]} ifaces
 */
function isAllowedPeerAddress(remoteAddress, ifaces) {
  if (!remoteAddress) return false;
  if (isLoopback(remoteAddress)) return true;
  return (ifaces || []).some((iface) => isSameSubnet(remoteAddress, iface));
}

/**
 * Địa chỉ broadcast: 255.255.255.255 + broadcast của từng interface (directed broadcast
 * cần thiết trên Windows có nhiều card mạng).
 * @param {Ipv4Iface[]} ifaces
 * @returns {string[]}
 */
function broadcastAddresses(ifaces) {
  const set = new Set(['255.255.255.255']);
  for (const iface of ifaces || []) {
    const a = ipToInt(iface.address);
    const m = ipToInt(iface.netmask);
    if (a === null || m === null) continue;
    set.add(intToIp(((a & m) | (~m >>> 0)) >>> 0));
  }
  return Array.from(set);
}

module.exports = {
  listIpv4Interfaces,
  ipToInt,
  intToIp,
  normalizeRemoteAddress,
  isLoopback,
  isSameSubnet,
  isAllowedPeerAddress,
  broadcastAddresses,
};
