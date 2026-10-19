'use strict';

const test = require('node:test');
const assert = require('node:assert');
const vc = require('../shared/vectorClock');
const { createClockService } = require('../electron/modules/chat/clockService');
const { makeRepos } = require('./helpers');

test('clock service ticks own counter and merges max element-wise (persisted)', () => {
  const repos = makeRepos();
  const clock = createClockService(repos.vectorClock);
  assert.deepStrictEqual(clock.tick(1), { 1: 1 });
  assert.deepStrictEqual(clock.tick(1), { 1: 2 });
  assert.deepStrictEqual(clock.merge({ 1: 1, 2: 5 }), { 1: 2, 2: 5 });
  assert.deepStrictEqual(repos.vectorClock.getClock(), { 1: 2, 2: 5 });
});

test('messages sort by server_id, then causality, then tie-breaker', () => {
  const a = { server_id: null, vector_clock: { 1: 1 }, created_at_local: '2026-01-01T00:00:05Z', sender_id: 1, client_message_id: 'a' };
  const b = { server_id: null, vector_clock: { 1: 1, 2: 1 }, created_at_local: '2026-01-01T00:00:01Z', sender_id: 2, client_message_id: 'b' };
  const c = { server_id: null, vector_clock: { 3: 1 }, created_at_local: '2026-01-01T00:00:00Z', sender_id: 3, client_message_id: 'c' };
  // b causally after a despite earlier local time
  assert.strictEqual(vc.compareMessages(a, b), -1);
  // a and c concurrent → created_at_local decides
  assert.ok(vc.compareMessages(c, a) < 0);
  assert.ok(vc.compareMessages({ server_id: 2 }, { server_id: 5 }) < 0);
});
