'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const W = require('../src/shared/wsEvents');
const C = require('../src/shared/constants');
const { bootServer, registerUser, delay } = require('./helpers');

describe('messages', () => {
  let server;
  let a;
  let b;
  let c;
  let direct;
  let group;

  const send = (u, convId, extra) =>
    u.client.request(W.MESSAGE.SEND, {
      client_message_id: crypto.randomUUID(),
      conversation_id: convId,
      type: C.MESSAGE_TYPE.TEXT,
      content: 'xin chào',
      ...(extra || {}),
    });

  before(async () => {
    server = await bootServer();
    a = await registerUser(server.port, 'ma');
    b = await registerUser(server.port, 'mb');
    c = await registerUser(server.port, 'mc');
    direct = (await a.client.request(W.CONV.CREATE, { type: C.CONVERSATION_TYPE.DIRECT, member_ids: [b.user.id] })).data.conversation;
    group = (await a.client.request(W.CONV.CREATE, { type: C.CONVERSATION_TYPE.GROUP, name: 'G', member_ids: [b.user.id, c.user.id] })).data.conversation;
  });
  after(async () => {
    for (const u of [a, b, c]) await u.client.close();
    await server.close();
  });

  it('send is idempotent on client_message_id and broadcasts message:new', async () => {
    const cmid = crypto.randomUUID();
    const replyTarget = crypto.randomUUID();
    const r1 = await send(a, direct.id, {
      client_message_id: cmid,
      content: '  xin chào @B  ',
      reply_to: replyTarget,
      mentions: [b.user.id, 99999],
      vector_clock: { [a.user.id]: 3, bogus: 'x' },
      created_at_local: '2026-10-18T01:02:03.000Z',
    });
    assert.equal(r1.type, W.MESSAGE.SENT);
    const m = r1.data.message;
    assert.ok(Number.isInteger(m.server_id));
    assert.equal(m.conversation_id, direct.id);
    assert.equal(m.content, 'xin chào @B');
    assert.equal(m.reply_to, replyTarget);
    assert.deepEqual(m.mentions, [b.user.id], 'mentions ngoài conversation bị loại');
    assert.deepEqual(m.vector_clock, { [a.user.id]: 3 });
    assert.equal(m.created_at_local, '2026-10-18T01:02:03.000Z');
    const pushed = await b.client.waitFor(W.MESSAGE.NEW, (x) => x.message.client_message_id === cmid);
    assert.equal(pushed.data.message.server_id, m.server_id);
    await a.client.waitFor(W.MESSAGE.NEW, (x) => x.message.client_message_id === cmid);

    const r2 = await send(a, direct.id, { client_message_id: cmid, content: 'khác' });
    assert.equal(r2.data.message.server_id, m.server_id);
    assert.equal(r2.data.message.content, 'xin chào @B');
    await delay(100);
    assert.equal(b.client.count(W.MESSAGE.NEW, (x) => x.message.client_message_id === cmid), 0, 'không broadcast lại');

    const steal = await send(b, direct.id, { client_message_id: cmid });
    assert.equal(steal.error.code, C.ERROR_CODE.CONFLICT);
    const empty = await send(a, direct.id, { content: '   ' });
    assert.equal(empty.error.code, C.ERROR_CODE.VALIDATION);
    const sys = await send(a, direct.id, { type: C.MESSAGE_TYPE.SYSTEM });
    assert.equal(sys.error.code, C.ERROR_CODE.VALIDATION);
    const outsider = await send(c, direct.id);
    assert.equal(outsider.error.code, C.ERROR_CODE.FORBIDDEN);
  });

  it('delivered/read cursors are monotonic and broadcast status_update', async () => {
    const m1 = (await send(a, direct.id)).data.message;
    const m2 = (await send(a, direct.id)).data.message;
    const d = await b.client.request(W.MESSAGE.DELIVERED, { conversation_id: direct.id, server_id: m2.server_id });
    assert.equal(d.type, W.MESSAGE.RESULT);
    const s1 = await a.client.waitFor(W.MESSAGE.STATUS_UPDATE, (x) => x.user_id === b.user.id && x.last_delivered_message_id === m2.server_id);
    assert.equal(s1.data.conversation_id, direct.id);

    await b.client.request(W.MESSAGE.READ, { conversation_id: direct.id, server_id: m1.server_id });
    const s2 = await a.client.waitFor(W.MESSAGE.STATUS_UPDATE, (x) => x.user_id === b.user.id && x.last_read_message_id === m1.server_id);
    assert.equal(s2.data.last_delivered_message_id, m2.server_id, 'delivered không lùi');

    // Lùi con trỏ → không đổi, không broadcast
    await b.client.request(W.MESSAGE.DELIVERED, { conversation_id: direct.id, server_id: m1.server_id });
    await delay(100);
    assert.equal(a.client.count(W.MESSAGE.STATUS_UPDATE, (x) => x.user_id === b.user.id), 0);

    // Đọc vượt quá tin cuối → kẹp về tin cuối; read ⇒ delivered
    await b.client.request(W.MESSAGE.READ, { conversation_id: direct.id, server_id: m2.server_id + 1000 });
    const s3 = await a.client.waitFor(W.MESSAGE.STATUS_UPDATE, (x) => x.user_id === b.user.id && x.last_read_message_id === m2.server_id);
    assert.equal(s3.data.last_delivered_message_id, m2.server_id);
    const list = await a.client.request(W.CONV.LIST, {});
    const member = list.data.conversations.find((x) => x.id === direct.id).members.find((x) => x.user_id === b.user.id);
    assert.equal(member.last_read_message_id, m2.server_id);
  });

  it('edit and recall are restricted to the sender', async () => {
    const m = (await send(a, group.id, { content: 'bản gốc' })).data.message;
    const byOther = await b.client.request(W.MESSAGE.EDIT, { conversation_id: group.id, client_message_id: m.client_message_id, content: 'hack' });
    assert.equal(byOther.error.code, C.ERROR_CODE.FORBIDDEN);
    const ok = await a.client.request(W.MESSAGE.EDIT, { conversation_id: group.id, client_message_id: m.client_message_id, content: 'đã sửa' });
    assert.equal(ok.type, W.MESSAGE.RESULT);
    assert.equal(ok.data.ok, true);
    const edited = await c.client.waitFor(W.MESSAGE.EDITED, (x) => x.message.client_message_id === m.client_message_id);
    assert.equal(edited.data.message.content, 'đã sửa');
    assert.equal(edited.data.message.edited, true);

    const recallOther = await b.client.request(W.MESSAGE.RECALL, { conversation_id: group.id, client_message_id: m.client_message_id });
    assert.equal(recallOther.error.code, C.ERROR_CODE.FORBIDDEN);
    const recall = await a.client.request(W.MESSAGE.RECALL, { conversation_id: group.id, client_message_id: m.client_message_id });
    assert.equal(recall.data.ok, true);
    const rec = await b.client.waitFor(W.MESSAGE.RECALLED, (x) => x.client_message_id === m.client_message_id);
    assert.equal(rec.data.conversation_id, group.id);
    const editRecalled = await a.client.request(W.MESSAGE.EDIT, { conversation_id: group.id, client_message_id: m.client_message_id, content: 'x' });
    assert.equal(editRecalled.error.code, C.ERROR_CODE.VALIDATION);
    const hist = await b.client.request(W.MESSAGE.HISTORY, { conversation_id: group.id });
    const stored = hist.data.messages.find((x) => x.client_message_id === m.client_message_id);
    assert.equal(stored.recalled, true);
    assert.equal(stored.content, '');
  });

  it('pin rules: owner/admin in groups, both members in direct', async () => {
    const gm = (await send(b, group.id, { content: 'ghim tôi' })).data.message;
    const byMember = await b.client.request(W.MESSAGE.PIN, { conversation_id: group.id, client_message_id: gm.client_message_id });
    assert.equal(byMember.error.code, C.ERROR_CODE.FORBIDDEN);
    const byOwner = await a.client.request(W.MESSAGE.PIN, { conversation_id: group.id, client_message_id: gm.client_message_id });
    assert.equal(byOwner.data.ok, true);
    const pinned = await c.client.waitFor(W.CONV.PINNED, (x) => x.conversation_id === group.id);
    assert.equal(pinned.data.pinned[0].client_message_id, gm.client_message_id);
    assert.equal(pinned.data.pinned[0].content_preview, 'ghim tôi');
    await a.client.request(W.MESSAGE.UNPIN, { conversation_id: group.id, client_message_id: gm.client_message_id });
    const unpinned = await c.client.waitFor(W.CONV.UNPINNED, (x) => x.conversation_id === group.id);
    assert.deepEqual(unpinned.data.pinned, []);

    const dm = (await send(a, direct.id)).data.message;
    const byB = await b.client.request(W.MESSAGE.PIN, { conversation_id: direct.id, client_message_id: dm.client_message_id });
    assert.equal(byB.data.ok, true);
  });

  it('history paginates with before_server_id and has_more', async () => {
    const conv = (await a.client.request(W.CONV.CREATE, { type: C.CONVERSATION_TYPE.GROUP, name: 'Trang', member_ids: [b.user.id, c.user.id] })).data.conversation;
    for (let i = 0; i < 55; i += 1) await send(a, conv.id, { content: `tin ${i}` });
    const page1 = await a.client.request(W.MESSAGE.HISTORY, { conversation_id: conv.id, limit: 999 });
    assert.equal(page1.data.messages.length, C.PAGE_SIZE);
    assert.equal(page1.data.has_more, true);
    assert.ok(page1.data.messages[0].server_id < page1.data.messages[1].server_id, 'tăng dần');
    const page2 = await a.client.request(W.MESSAGE.HISTORY, { conversation_id: conv.id, before_server_id: page1.data.messages[0].server_id });
    assert.equal(page2.data.has_more, false);
    assert.equal(page2.data.messages.length, 56 - C.PAGE_SIZE); // 55 tin + 1 tin system
  });

  it('relays typing to other members with display_name', async () => {
    a.client.emit(W.TYPING.TYPING, { conversation_id: group.id });
    const t = await b.client.waitFor(W.TYPING.TYPING, (x) => x.conversation_id === group.id);
    assert.equal(t.data.user_id, a.user.id);
    assert.equal(t.data.display_name, a.user.display_name);
  });

  it('relays call signaling with from_user_id and from_name', async () => {
    const r = await a.client.request(W.CALL.OFFER, { to_user_id: b.user.id, sdp: 'v=0' });
    assert.equal(r.data.ok, true);
    const offer = await b.client.waitFor(W.CALL.OFFER);
    assert.equal(offer.data.from_user_id, a.user.id);
    assert.equal(offer.data.from_name, a.user.display_name);
    assert.equal(offer.data.sdp, 'v=0');
  });
});
