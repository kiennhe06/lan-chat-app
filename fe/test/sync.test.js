'use strict';

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { makeRepos, silentLogger } = require('./helpers');
const { buildMessageBatches, SyncService } = require('../electron/modules/sync/syncService');
const { remapConversationId } = require('../electron/modules/chat/inboundService');
const { SYNC, MESSAGE } = require('../shared/wsEvents');
const { SYNC_STATE, ACTION_TYPE } = require('../shared/constants');

const fakeView = () => ({ emitMessage() {}, emitConversation() {}, emitConversationRemoved() {}, emitUsers() {} });

test('buildMessageBatches splits into ≤100 and attaches file ids by sha', () => {
  const rows = Array.from({ length: 230 }, (_, i) => ({
    client_message_id: `c${i}`, conversation_id: '5', sender_id: 1, type: i === 0 ? 'file' : 'text', content: 'x',
    file: i === 0 ? { id: null, sha256: 'a'.repeat(64), name: 'f' } : null, mentions: [], vector_clock: { 1: i }, created_at_local: 't',
  }));
  const batches = buildMessageBatches(rows, { ['a'.repeat(64)]: 77 });
  assert.deepStrictEqual(batches.map((b) => b.length), [100, 100, 30]);
  assert.strictEqual(batches[0][0].file_id, 77);
  assert.strictEqual(batches[0][0].file_sha256, 'a'.repeat(64));
  assert.strictEqual(batches[0][1].file_id, undefined);
});

test('remapConversationId moves messages, conversation and queued actions from temp to real id', () => {
  const repos = makeRepos();
  const temp = 'temp-abc';
  repos.conversations.upsertFromWire({ id: temp, type: 'group', name: 'G', members: [{ user_id: 1, role: 'owner' }] }, { sync_state: SYNC_STATE.PENDING_SERVER });
  repos.messages.insert({ client_message_id: crypto.randomUUID(), conversation_id: temp, sender_id: 1, type: 'text', content: 'hi', sync_state: SYNC_STATE.PENDING_PEER, created_at_local: 't' });
  repos.actions.enqueue(ACTION_TYPE.CONV_RENAME, { conversation_id: temp, name: 'G2' });
  const res = remapConversationId(repos, temp, '42');
  assert.strictEqual(res.messages, 1);
  assert.strictEqual(res.actions, 1);
  assert.strictEqual(repos.conversations.get(temp), null);
  assert.ok(repos.conversations.get('42'));
  assert.strictEqual(repos.actions.list()[0].payload.conversation_id, '42');
});

test('SyncService.run: conv_create remaps temp id, then pushes messages and marks them synced', async () => {
  const repos = makeRepos();
  const me = 1;
  const temp = 'temp-xyz';
  repos.conversations.upsertFromWire({ id: temp, type: 'group', name: 'G', client_temp_id: temp, members: [{ user_id: 1, role: 'owner' }, { user_id: 2, role: 'member' }, { user_id: 3, role: 'member' }] }, { sync_state: SYNC_STATE.PENDING_SERVER });
  const cmid = crypto.randomUUID();
  repos.messages.insert({ client_message_id: cmid, conversation_id: temp, sender_id: me, type: 'text', content: 'offline', sync_state: SYNC_STATE.PARTIAL_PEER, created_at_local: '2026-01-01T00:00:00.000Z' });
  repos.actions.enqueue(ACTION_TYPE.CONV_CREATE, { client_temp_id: temp, name: 'G', member_ids: [2, 3] });

  const calls = [];
  const events = [];
  const request = async (type, data) => {
    calls.push(type);
    if (type === SYNC.REQUEST) return { conversations: [], users: [], messages: [], deleted_conversation_ids: [] };
    if (type === SYNC.ACTION_BATCH) {
      return { results: data.actions.map((a) => ({ client_action_id: a.client_action_id, ok: true, result: { conversation: { id: '9', type: 'group', name: 'G', client_temp_id: temp, members: [{ user_id: 1, role: 'owner' }] } } })) };
    }
    if (type === SYNC.MESSAGE_BATCH) {
      assert.strictEqual(data.messages[0].conversation_id, '9');
      return { results: data.messages.map((m, i) => ({ client_message_id: m.client_message_id, ok: true, status: 'ok', server_id: 500 + i, created_at: 'T' })) };
    }
    return {};
  };
  const sent = [];
  const sync = new SyncService({ request, send: (t, d) => sent.push([t, d]), repos, view: fakeView(), emit: (c, p) => events.push([c, p]), logger: silentLogger, getMyUserId: () => me });
  const stats = await sync.run();
  assert.deepStrictEqual(calls, [SYNC.REQUEST, SYNC.ACTION_BATCH, SYNC.MESSAGE_BATCH]);
  assert.strictEqual(stats.messages, 1);
  const row = repos.messages.get(cmid);
  assert.strictEqual(row.server_id, 500);
  assert.strictEqual(row.conversation_id, '9');
  assert.strictEqual(row.sync_state, SYNC_STATE.SYNCED);
  assert.ok(events.some(([c, p]) => c === 'evt:conversation-id-changed' && p.old_id === temp && p.new_id === '9'));
  assert.ok(events.some(([c, p]) => c === 'evt:toast' && p.text === 'Đã đồng bộ 1 tin, 0 file'));
  assert.ok(sent.some(([t]) => t === SYNC.ACK));
  assert.strictEqual(repos.actions.count(), 0);
  assert.ok(!sent.some(([t]) => t === MESSAGE.DELIVERED));
});

test('CONV_NOT_SYNCED result keeps the message unsynced for the next run', async () => {
  const repos = makeRepos();
  const cmid = crypto.randomUUID();
  repos.messages.insert({ client_message_id: cmid, conversation_id: '3', sender_id: 1, type: 'text', content: 'x', sync_state: SYNC_STATE.PENDING_SERVER, created_at_local: 't' });
  const request = async (type, data) => {
    if (type === SYNC.MESSAGE_BATCH) return { results: data.messages.map((m) => ({ client_message_id: m.client_message_id, ok: false, status: 'error', error: { code: 'CONV_NOT_SYNCED' } })) };
    return { conversations: [], users: [], messages: [] };
  };
  const sync = new SyncService({ request, repos, view: fakeView(), emit() {}, logger: silentLogger, getMyUserId: () => 1 });
  await sync.run();
  assert.strictEqual(repos.messages.get(cmid).sync_state, SYNC_STATE.PENDING_SERVER);
});
