'use strict';

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { makeRepos } = require('./helpers');
const { computeSortKey } = require('../electron/modules/chat/messageRepo');
const { SYNC_STATE, MESSAGE_STATUS } = require('../shared/constants');

function seed(repos, n, conv = '1') {
  for (let i = 1; i <= n; i += 1) {
    repos.messages.insert({ server_id: i, client_message_id: crypto.randomUUID(), conversation_id: conv, sender_id: 2, type: 'text', content: `m${i}`, status: 'sent', sync_state: 'synced' });
  }
}

test('sort_key: synced pads server_id, unsynced sorts after all synced', () => {
  const s = computeSortKey({ server_id: 42, sender_id: 1, client_message_id: 'x' });
  const u = computeSortKey({ server_id: null, created_at_local: '2026-01-01T00:00:00.000Z', sender_id: 1, client_message_id: 'x' });
  assert.strictEqual(s, 'S000000000000042');
  assert.ok(u > computeSortKey({ server_id: 999999999, sender_id: 1, client_message_id: 'y' }));
});

test('listPage paginates 50 per page ascending with has_more/oldest_key', () => {
  const repos = makeRepos();
  seed(repos, 120);
  const p1 = repos.messages.listPage('1', null);
  assert.strictEqual(p1.messages.length, 50);
  assert.strictEqual(p1.messages[0].server_id, 71);
  assert.strictEqual(p1.messages[49].server_id, 120);
  assert.strictEqual(p1.has_more, true);
  const p2 = repos.messages.listPage('1', p1.oldest_key);
  assert.strictEqual(p2.messages[0].server_id, 21);
  const p3 = repos.messages.listPage('1', p2.oldest_key);
  assert.strictEqual(p3.messages.length, 20);
  assert.strictEqual(p3.has_more, false);
});

test('unsynced message is re-keyed when the server assigns an id', () => {
  const repos = makeRepos();
  seed(repos, 3);
  const cmid = crypto.randomUUID();
  repos.messages.insert({ client_message_id: cmid, conversation_id: '1', sender_id: 1, type: 'text', content: 'local', created_at_local: '2026-01-01T00:00:00.000Z', sync_state: SYNC_STATE.PENDING_PEER });
  assert.ok(repos.messages.get(cmid).sort_key.startsWith('U'));
  const updated = repos.messages.upsertFromServer({ client_message_id: cmid, server_id: 10, conversation_id: '1', sender_id: 1, type: 'text', content: 'local' });
  assert.strictEqual(updated.message.sort_key, 'S000000000000010');
  assert.strictEqual(updated.message.sync_state, SYNC_STATE.SYNCED);
  assert.strictEqual(updated.message.status, MESSAGE_STATUS.SENT);
  const page = repos.messages.listPage('1', null);
  assert.strictEqual(page.messages[page.messages.length - 1].client_message_id, cmid);
});

test('status only moves forward via upsertFromServer', () => {
  const repos = makeRepos();
  const cmid = crypto.randomUUID();
  repos.messages.insert({ client_message_id: cmid, server_id: 1, conversation_id: '1', sender_id: 1, type: 'text', content: 'x', status: MESSAGE_STATUS.READ });
  const r = repos.messages.upsertFromServer({ client_message_id: cmid, server_id: 1, conversation_id: '1', sender_id: 1, type: 'text', content: 'x' });
  assert.strictEqual(r.message.status, MESSAGE_STATUS.READ);
});

test('search is case-insensitive for Vietnamese text', () => {
  const repos = makeRepos();
  repos.messages.insert({ client_message_id: crypto.randomUUID(), server_id: 1, conversation_id: '1', sender_id: 1, type: 'text', content: 'Xin CHÀO Anh' });
  assert.strictEqual(repos.messages.search('1', 'chào', 10).length, 1);
});
