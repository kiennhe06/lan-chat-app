'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { isAllowedPeerAddress, broadcastAddresses, isSameSubnet } = require('../electron/core/utils/net');

const ifaces = [{ address: '192.168.1.20', netmask: '255.255.255.0' }];

test('same subnet and loopback are allowed; other subnets rejected', () => {
  assert.strictEqual(isAllowedPeerAddress('192.168.1.77', ifaces), true);
  assert.strictEqual(isAllowedPeerAddress('::ffff:192.168.1.77', ifaces), true);
  assert.strictEqual(isAllowedPeerAddress('127.0.0.1', ifaces), true);
  assert.strictEqual(isAllowedPeerAddress('::1', ifaces), true);
  assert.strictEqual(isAllowedPeerAddress('192.168.2.5', ifaces), false);
  assert.strictEqual(isAllowedPeerAddress('8.8.8.8', ifaces), false);
  assert.strictEqual(isSameSubnet('10.0.5.1', { address: '10.0.0.1', netmask: '255.255.0.0' }), true);
});

test('broadcast addresses include limited + directed broadcast', () => {
  assert.deepStrictEqual(broadcastAddresses(ifaces), ['255.255.255.255', '192.168.1.255']);
});
