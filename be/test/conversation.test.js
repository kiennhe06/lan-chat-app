'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const W = require('../src/shared/wsEvents');
const C = require('../src/shared/constants');
const { bootServer, registerUser } = require('./helpers');

describe('conversations & groups', () => {
  let server;
  let a;
  let b;
  let c;
  let d;

  before(async () => {
    server = await bootServer();
    a = await registerUser(server.port, 'a');
    b = await registerUser(server.port, 'b');
    c = await registerUser(server.port, 'c');
    d = await registerUser(server.port, 'd');
  });
  after(async () => {
    for (const u of [a, b, c, d]) await u.client.close();
    await server.close();
  });

  it('direct conversation is find-or-create by user pair', async () => {
    const r1 = await a.client.request(W.CONV.CREATE, { type: C.CONVERSATION_TYPE.DIRECT, member_ids: [b.user.id] });
    assert.equal(r1.type, W.CONV.CREATED);
    const conv = r1.data.conversation;
    assert.equal(typeof conv.id, 'string');
    assert.equal(conv.type, C.CONVERSATION_TYPE.DIRECT);
    assert.deepEqual(conv.members.map((m) => m.user_id).sort(), [a.user.id, b.user.id].sort());
    await b.client.waitFor(W.CONV.CREATED, (x) => x.conversation.id === conv.id);
    const r2 = await a.client.request(W.CONV.CREATE, { type: C.CONVERSATION_TYPE.DIRECT, member_ids: [b.user.id] });
    const r3 = await b.client.request(W.CONV.CREATE, { type: C.CONVERSATION_TYPE.DIRECT, member_ids: [a.user.id] });
    assert.equal(r2.data.conversation.id, conv.id);
    assert.equal(r3.data.conversation.id, conv.id);
    const self = await a.client.request(W.CONV.CREATE, { type: C.CONVERSATION_TYPE.DIRECT, member_ids: [a.user.id] });
    assert.equal(self.error.code, C.ERROR_CODE.VALIDATION);
  });

  it('group needs at least MIN_GROUP_OTHER_MEMBERS other members', async () => {
    const r = await a.client.request(W.CONV.CREATE, { type: C.CONVERSATION_TYPE.GROUP, name: 'Nhỏ', member_ids: [b.user.id] });
    assert.equal(r.error.code, C.ERROR_CODE.VALIDATION);
    const r2 = await a.client.request(W.CONV.CREATE, { type: C.CONVERSATION_TYPE.GROUP, name: 'Nhỏ', member_ids: [b.user.id, a.user.id] });
    assert.equal(r2.error.code, C.ERROR_CODE.VALIDATION, 'chính mình không tính là người khác');
  });

  it('enforces group roles: pending, approve, admin rules, owner protection, delete', async () => {
    const created = await a.client.request(W.CONV.CREATE, {
      type: C.CONVERSATION_TYPE.GROUP,
      name: '  Nhóm   Dự án ',
      member_ids: [b.user.id, c.user.id],
    });
    const conv = created.data.conversation;
    const id = conv.id;
    assert.equal(conv.name, 'Nhóm Dự án');
    assert.equal(conv.owner_id, a.user.id);
    assert.equal(conv.members.find((m) => m.user_id === a.user.id).role, C.GROUP_ROLE.OWNER);
    assert.equal(conv.last_message.type, C.MESSAGE_TYPE.SYSTEM);
    await c.client.waitFor(W.CONV.CREATED, (x) => x.conversation.id === id);

    // Member thêm người → pending, owner nhận memberPending
    const add = await b.client.request(W.CONV.ADD_MEMBER, { conversation_id: id, user_ids: [d.user.id] });
    assert.deepEqual(add.data, { added: [], pending: [d.user.id] });
    const pend = await a.client.waitFor(W.CONV.MEMBER_PENDING, (x) => x.conversation_id === id && x.pending_count === 1);
    assert.equal(pend.data.pending_count, 1);
    const list = await a.client.request(W.CONV.REQUEST_PENDING, { conversation_id: id });
    assert.equal(list.data.pending[0].user_id, d.user.id);
    assert.equal(list.data.pending[0].requested_by, b.user.id);
    const memberList = await b.client.request(W.CONV.REQUEST_PENDING, { conversation_id: id });
    assert.equal(memberList.error.code, C.ERROR_CODE.FORBIDDEN);
    const memberApprove = await c.client.request(W.CONV.APPROVE_MEMBER, { conversation_id: id, user_id: d.user.id });
    assert.equal(memberApprove.error.code, C.ERROR_CODE.FORBIDDEN);

    // Owner duyệt → D nhận conv:created
    const ok = await a.client.request(W.CONV.APPROVE_MEMBER, { conversation_id: id, user_id: d.user.id });
    assert.equal(ok.type, W.CONV.RESULT);
    assert.equal(ok.data.ok, true);
    await d.client.waitFor(W.CONV.CREATED, (x) => x.conversation.id === id);
    await a.client.waitFor(W.CONV.MEMBER_PENDING, (x) => x.conversation_id === id && x.pending_count === 0);

    // Set admin: chỉ owner
    const setB = await a.client.request(W.CONV.SET_ADMIN, { conversation_id: id, user_id: b.user.id, is_admin: true });
    assert.equal(setB.data.ok, true);
    await c.client.waitFor(W.CONV.UPDATED, (x) => x.conversation.id === id && x.conversation.members.some((m) => m.user_id === b.user.id && m.role === C.GROUP_ROLE.ADMIN));
    const adminSets = await b.client.request(W.CONV.SET_ADMIN, { conversation_id: id, user_id: c.user.id, is_admin: true });
    assert.equal(adminSets.error.code, C.ERROR_CODE.FORBIDDEN);

    // Không xóa được owner; admin xóa được member; không tự xóa mình
    const removeOwner = await b.client.request(W.CONV.REMOVE_MEMBER, { conversation_id: id, user_id: a.user.id });
    assert.equal(removeOwner.error.code, C.ERROR_CODE.FORBIDDEN);
    const removeSelf = await b.client.request(W.CONV.REMOVE_MEMBER, { conversation_id: id, user_id: b.user.id });
    assert.equal(removeSelf.error.code, C.ERROR_CODE.VALIDATION);
    const memberRemoves = await c.client.request(W.CONV.REMOVE_MEMBER, { conversation_id: id, user_id: d.user.id });
    assert.equal(memberRemoves.error.code, C.ERROR_CODE.FORBIDDEN);
    const removeD = await b.client.request(W.CONV.REMOVE_MEMBER, { conversation_id: id, user_id: d.user.id });
    assert.equal(removeD.data.ok, true);
    await d.client.waitFor(W.CONV.DELETED, (x) => x.conversation_id === id);

    // Admin thêm trực tiếp
    const addDirect = await b.client.request(W.CONV.ADD_MEMBER, { conversation_id: id, user_ids: [d.user.id] });
    assert.deepEqual(addDirect.data, { added: [d.user.id], pending: [] });

    // Mọi member đổi tên được
    const rename = await c.client.request(W.CONV.RENAME, { conversation_id: id, name: 'Tên mới' });
    assert.equal(rename.data.conversation.name, 'Tên mới');
    assert.ok(rename.data.conversation.version > conv.version);
    await a.client.waitFor(W.CONV.UPDATED, (x) => x.conversation.id === id && x.conversation.name === 'Tên mới');

    // Tin system được chèn
    const hist = await a.client.request(W.MESSAGE.HISTORY, { conversation_id: id });
    const systems = hist.data.messages.filter((m) => m.type === C.MESSAGE_TYPE.SYSTEM);
    assert.ok(systems.length >= 5, `cần ≥5 tin system, có ${systems.length}`);

    // pending_count chỉ hiện với owner/admin
    const convListC = await c.client.request(W.CONV.LIST, {});
    assert.equal(convListC.data.conversations.find((x) => x.id === id).pending_count, 0);

    // Xóa nhóm: chỉ owner
    const delByAdmin = await b.client.request(W.CONV.DELETE, { conversation_id: id });
    assert.equal(delByAdmin.error.code, C.ERROR_CODE.FORBIDDEN);
    const del = await a.client.request(W.CONV.DELETE, { conversation_id: id });
    assert.equal(del.data.ok, true);
    await Promise.all([b, c, d].map((u) => u.client.waitFor(W.CONV.DELETED, (x) => x.conversation_id === id)));
    const after = await a.client.request(W.CONV.LIST, {});
    assert.ok(!after.data.conversations.some((x) => x.id === id));
  });

  it('non-members cannot access a conversation', async () => {
    const r = await a.client.request(W.CONV.CREATE, { type: C.CONVERSATION_TYPE.GROUP, name: 'Kín', member_ids: [b.user.id, c.user.id] });
    const hist = await d.client.request(W.MESSAGE.HISTORY, { conversation_id: r.data.conversation.id });
    assert.equal(hist.error.code, C.ERROR_CODE.FORBIDDEN);
    const missing = await d.client.request(W.MESSAGE.HISTORY, { conversation_id: '999999' });
    assert.equal(missing.error.code, C.ERROR_CODE.NOT_FOUND);
  });
});
