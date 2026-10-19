'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const W = require('../src/shared/wsEvents');
const C = require('../src/shared/constants');
const { bootServer, registerUser } = require('./helpers');

describe('sync', () => {
  let server;
  let a;
  let b;
  let c;
  let outsider;
  let group;

  const item = (convId, extra) => ({
    client_message_id: crypto.randomUUID(),
    conversation_id: convId,
    type: C.MESSAGE_TYPE.TEXT,
    content: 'offline',
    reply_to: null,
    mentions: [],
    vector_clock: {},
    created_at_local: new Date().toISOString(),
    ...(extra || {}),
  });
  const action = (type, payload) => ({
    client_action_id: crypto.randomUUID(),
    action_type: type,
    payload,
    vector_clock: {},
    created_at: new Date().toISOString(),
  });

  before(async () => {
    server = await bootServer();
    a = await registerUser(server.port, 'sa');
    b = await registerUser(server.port, 'sb');
    c = await registerUser(server.port, 'sc');
    outsider = await registerUser(server.port, 'so');
    group = (await a.client.request(W.CONV.CREATE, { type: C.CONVERSATION_TYPE.GROUP, name: 'Sync', member_ids: [b.user.id, c.user.id] })).data.conversation;
  });
  after(async () => {
    for (const u of [a, b, c, outsider]) await u.client.close();
    await server.close();
  });

  it('message-batch upserts idempotently and broadcasts new messages', async () => {
    const items = [item(group.id, { vector_clock: { [a.user.id]: 7 } }), item(group.id)];
    const r1 = await a.client.request(W.SYNC.MESSAGE_BATCH, { messages: items });
    assert.equal(r1.type, W.SYNC.MESSAGE_BATCH_ACK);
    assert.ok(r1.data.results.every((x) => x.ok && x.status === 'ok' && x.server_id && x.created_at));
    await b.client.waitFor(W.MESSAGE.NEW, (x) => x.message.client_message_id === items[0].client_message_id);
    const r2 = await a.client.request(W.SYNC.MESSAGE_BATCH, { messages: items });
    assert.deepEqual(r2.data.results.map((x) => x.server_id), r1.data.results.map((x) => x.server_id));

    const tooMany = await a.client.request(W.SYNC.MESSAGE_BATCH, { messages: new Array(101).fill(0).map(() => item(group.id)) });
    assert.equal(tooMany.error.code, C.ERROR_CODE.VALIDATION);
  });

  it('accepts peer-relayed messages only when sender and pusher are both members', async () => {
    const relayed = item(group.id, { sender_id: a.user.id, content: 'chuyển hộ' });
    const r = await b.client.request(W.SYNC.MESSAGE_BATCH, { messages: [relayed] });
    assert.equal(r.data.results[0].ok, true);
    const hist = await c.client.request(W.MESSAGE.HISTORY, { conversation_id: group.id });
    assert.equal(hist.data.messages.find((m) => m.client_message_id === relayed.client_message_id).sender_id, a.user.id);

    const bad = await outsider.client.request(W.SYNC.MESSAGE_BATCH, { messages: [item(group.id, { sender_id: a.user.id })] });
    assert.equal(bad.data.results[0].ok, false);
    assert.equal(bad.data.results[0].status, 'error');
    assert.equal(bad.data.results[0].error.code, C.ERROR_CODE.FORBIDDEN);
  });

  it('maps temp- conversations via client_temp_id (CONV_NOT_SYNCED until conv_create)', async () => {
    const tempId = `${C.TEMP_CONVERSATION_PREFIX}${crypto.randomUUID()}`;
    const msg = item(tempId, { content: 'tạo offline' });
    const early = await b.client.request(W.SYNC.MESSAGE_BATCH, { messages: [msg] });
    assert.equal(early.data.results[0].ok, false);
    assert.equal(early.data.results[0].error.code, C.ERROR_CODE.CONV_NOT_SYNCED);

    const create = action(C.ACTION_TYPE.CONV_CREATE, { client_temp_id: tempId, name: 'Nhóm offline', member_ids: [a.user.id, c.user.id] });
    const rename = action(C.ACTION_TYPE.CONV_RENAME, { conversation_id: tempId, name: 'Đổi offline', version: 2, updated_at: new Date().toISOString() });
    // rename đứng trước conv_create trong batch: server vẫn xử lý conv_create trước
    const ack = await b.client.request(W.SYNC.ACTION_BATCH, { actions: [rename, create] });
    assert.equal(ack.type, W.SYNC.ACTION_BATCH_ACK);
    const [renameRes, createRes] = ack.data.results;
    assert.equal(createRes.ok, true);
    const conv = createRes.result.conversation;
    assert.equal(conv.client_temp_id, tempId);
    assert.equal(conv.owner_id, b.user.id);
    assert.equal(renameRes.ok, true);
    assert.equal(renameRes.result.conversation.name, 'Đổi offline');
    const pushed = await a.client.waitFor(W.CONV.CREATED, (x) => x.conversation.client_temp_id === tempId);
    assert.equal(pushed.data.conversation.id, conv.id);

    const later = await b.client.request(W.SYNC.MESSAGE_BATCH, { messages: [msg] });
    assert.equal(later.data.results[0].ok, true);
    const newMsg = await c.client.waitFor(W.MESSAGE.NEW, (x) => x.message.client_message_id === msg.client_message_id);
    assert.equal(newMsg.data.message.conversation_id, conv.id);

    // Gửi lại cùng action (mất ack) → idempotent, cùng conversation
    const again = await b.client.request(W.SYNC.ACTION_BATCH, { actions: [create] });
    assert.equal(again.data.results[0].result.conversation.id, conv.id);
    const viaNewAction = await b.client.request(W.SYNC.ACTION_BATCH, {
      actions: [action(C.ACTION_TYPE.CONV_CREATE, { client_temp_id: tempId, name: 'x', member_ids: [a.user.id, c.user.id] })],
    });
    assert.equal(viaNewAction.data.results[0].result.conversation.id, conv.id);
  });

  it('conv_rename is last-writer-wins by (updated_at, user_id)', async () => {
    const online = await a.client.request(W.CONV.RENAME, { conversation_id: group.id, name: 'Tên online' });
    assert.equal(online.data.conversation.name, 'Tên online');
    const stale = action(C.ACTION_TYPE.CONV_RENAME, { conversation_id: group.id, name: 'Tên cũ offline', version: 1, updated_at: '2020-01-01T00:00:00.000Z' });
    const r = await b.client.request(W.SYNC.ACTION_BATCH, { actions: [stale] });
    assert.equal(r.data.results[0].ok, true);
    assert.equal(r.data.results[0].conflict, true);
    assert.equal(r.data.results[0].result.conversation.name, 'Tên online', 'giữ bản server');

    const fresh = action(C.ACTION_TYPE.CONV_RENAME, { conversation_id: group.id, name: 'Tên mới hơn', version: 5, updated_at: new Date(Date.now() + 60000).toISOString() });
    const r2 = await b.client.request(W.SYNC.ACTION_BATCH, { actions: [fresh] });
    assert.ok(!r2.data.results[0].conflict);
    assert.equal(r2.data.results[0].result.conversation.name, 'Tên mới hơn');
    await c.client.waitFor(W.CONV.UPDATED, (x) => x.conversation.id === group.id && x.conversation.name === 'Tên mới hơn');
  });

  it('message_edit / message_recall actions reuse the online paths', async () => {
    const m = (await a.client.request(W.MESSAGE.SEND, { client_message_id: crypto.randomUUID(), conversation_id: group.id, type: 'text', content: 'gốc' })).data.message;
    const edit = action(C.ACTION_TYPE.MESSAGE_EDIT, { conversation_id: group.id, client_message_id: m.client_message_id, content: 'sửa offline', updated_at: new Date().toISOString() });
    const recall = action(C.ACTION_TYPE.MESSAGE_RECALL, { conversation_id: group.id, client_message_id: m.client_message_id });
    const r = await a.client.request(W.SYNC.ACTION_BATCH, { actions: [edit, recall] });
    assert.ok(r.data.results.every((x) => x.ok));
    await b.client.waitFor(W.MESSAGE.EDITED, (x) => x.message.client_message_id === m.client_message_id);
    await b.client.waitFor(W.MESSAGE.RECALLED, (x) => x.client_message_id === m.client_message_id);
    const bad = await b.client.request(W.SYNC.ACTION_BATCH, { actions: [action('unknown_type', {})] });
    assert.equal(bad.data.results[0].ok, false);
    assert.equal(bad.data.results[0].error.code, C.ERROR_CODE.VALIDATION);
  });

  it('sync:request returns conversations, users with online flag, messages since and deleted ids', async () => {
    const doomed = (await a.client.request(W.CONV.CREATE, { type: C.CONVERSATION_TYPE.GROUP, name: 'Sắp xóa', member_ids: [b.user.id, c.user.id] })).data.conversation;
    await a.client.request(W.CONV.DELETE, { conversation_id: doomed.id });
    const r = await b.client.request(W.SYNC.REQUEST, { since_server_id: 0, known_conversation_ids: [group.id, doomed.id] });
    assert.equal(r.type, W.SYNC.RESPONSE);
    assert.ok(r.data.conversations.some((x) => x.id === group.id));
    assert.deepEqual(r.data.deleted_conversation_ids, [doomed.id]);
    assert.ok(r.data.users.find((u) => u.id === a.user.id).online);
    assert.ok(r.data.messages.length > 0);
    assert.ok(r.data.messages.every((m, i, arr) => i === 0 || arr[i - 1].server_id < m.server_id));
    assert.equal(r.data.has_more, false);
    assert.ok(r.data.server_time);
    const maxId = r.data.messages[r.data.messages.length - 1].server_id;
    const none = await b.client.request(W.SYNC.REQUEST, { since_server_id: maxId });
    assert.equal(none.data.messages.length, 0);
    const ackR = await b.client.request(W.SYNC.ACK, { last_server_id: maxId });
    assert.equal(ackR.data.ok, true);
  });

  it('file-batch reports missing hashes', async () => {
    const sha = crypto.createHash('sha256').update('never uploaded').digest('hex');
    const r = await a.client.request(W.SYNC.FILE_BATCH, { files: [{ sha256: sha, size: 1, name: 'a.txt', mime_type: 'text/plain' }] });
    assert.equal(r.type, W.SYNC.FILE_BATCH_ACK);
    assert.deepEqual(r.data, { missing: [sha], existing: [] });
  });
});
