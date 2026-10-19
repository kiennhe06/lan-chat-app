'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { computeDeliveryState, lwwWins, encodeChunk, decodeChunk } = require('../electron/modules/p2p/p2pService');
const { SYNC_STATE, MESSAGE_STATUS } = require('../shared/constants');

test('group: no receipts → pending_peer, partial → partial_peer, all → pending_server + sent', () => {
  const others = [2, 3, 4];
  assert.deepStrictEqual(
    [computeDeliveryState({ isGroup: true, otherMemberIds: others, receipts: {} }).sync_state, computeDeliveryState({ isGroup: true, otherMemberIds: others, receipts: {} }).status],
    [SYNC_STATE.PENDING_PEER, MESSAGE_STATUS.PENDING],
  );
  const partial = computeDeliveryState({ isGroup: true, otherMemberIds: others, receipts: { 2: 't', 3: 't' } });
  assert.strictEqual(partial.sync_state, SYNC_STATE.PARTIAL_PEER);
  assert.strictEqual(partial.status, MESSAGE_STATUS.PENDING);
  const full = computeDeliveryState({ isGroup: true, otherMemberIds: others, receipts: { 2: 't', 3: 't', 4: 't' } });
  assert.strictEqual(full.sync_state, SYNC_STATE.PENDING_SERVER);
  assert.strictEqual(full.status, MESSAGE_STATUS.SENT);
});

test('direct: ack from the peer → pending_server/sent', () => {
  const s = computeDeliveryState({ isGroup: false, otherMemberIds: [2], receipts: { 2: 't' } });
  assert.strictEqual(s.sync_state, SYNC_STATE.PENDING_SERVER);
  assert.strictEqual(s.status, MESSAGE_STATUS.SENT);
});

test('LWW compares (updated_at, user_id)', () => {
  assert.strictEqual(lwwWins({ updated_at: 'b', user_id: 1 }, { updated_at: 'a', user_id: 9 }), true);
  assert.strictEqual(lwwWins({ updated_at: 'a', user_id: 2 }, { updated_at: 'a', user_id: 3 }), false);
  assert.strictEqual(lwwWins({ updated_at: 'a', user_id: 4 }, { updated_at: 'a', user_id: 3 }), true);
});

test('binary chunk header round-trips (36-byte transfer id + uint32 BE index)', () => {
  const id = '123e4567-e89b-12d3-a456-426614174000';
  const buf = encodeChunk(id, 70000, Buffer.from('data'));
  assert.strictEqual(buf.readUInt32BE(36), 70000);
  const d = decodeChunk(buf);
  assert.strictEqual(d.transferId, id);
  assert.strictEqual(d.index, 70000);
  assert.strictEqual(d.data.toString(), 'data');
});
