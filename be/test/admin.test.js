'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const W = require('../src/shared/wsEvents');
const C = require('../src/shared/constants');
const { listIpv4Interfaces } = require('../src/core/utils/network');
const { bootServer, TestClient, registerUser } = require('./helpers');

// Cần 1 IP LAN (không phải loopback) để giả lập client "khác máy" kết nối tới server
const lanIp = (listIpv4Interfaces()[0] || {}).address;

describe('admin & logs', () => {
  let server;
  let manager;
  let member;

  before(async () => {
    server = await bootServer();
    manager = await registerUser(server.port, 'mgr');
    member = await registerUser(server.port, 'mem');
  });
  after(async () => {
    await manager.client.close();
    await member.client.close();
    await server.close();
  });

  it('only manager can manage blocked IPs; loopback / own IP / invalid IP are rejected', async () => {
    const denied = await member.client.request(W.ADMIN.LIST_BLOCKED, {});
    assert.equal(denied.type, W.ADMIN.BLOCKED_LIST);
    assert.equal(denied.error.code, C.ERROR_CODE.FORBIDDEN);
    const loop = await manager.client.request(W.ADMIN.BLOCK_IP, { ip: '127.0.0.1', reason: 'x' });
    assert.equal(loop.error.code, C.ERROR_CODE.VALIDATION);
    const invalid = await manager.client.request(W.ADMIN.BLOCK_IP, { ip: '300.1.1.1' });
    assert.equal(invalid.error.code, C.ERROR_CODE.VALIDATION);
    const unblockMissing = await manager.client.request(W.ADMIN.UNBLOCK_IP, { ip: '10.9.9.9' });
    assert.equal(unblockMissing.error.code, C.ERROR_CODE.NOT_FOUND);
  });

  it('blocking an IP kicks its sockets and blocks HTTP; unblocking restores access', { skip: !lanIp && 'không có interface LAN' }, async () => {
    const remote = await TestClient.connect(server.port, lanIp);
    const login = await remote.request(W.AUTH.LOGIN, { identifier: member.input.username, password: member.input.password });
    assert.equal(login.type, W.AUTH.LOGIN_OK);

    const r = await manager.client.request(W.ADMIN.BLOCK_IP, { ip: lanIp, reason: 'Thử nghiệm' });
    assert.equal(r.type, W.ADMIN.BLOCK_IP_RESULT);
    assert.equal(r.data.kicked_count, 1);
    assert.equal(r.data.blocked.ip, lanIp);
    const kicked = await remote.waitFor(W.AUTH.KICKED);
    assert.equal(kicked.data.reason, C.MESSAGES_VI.BLOCKED);
    await remote.closed;

    const http403 = await fetch(server.httpUrl('/health', lanIp));
    assert.equal(http403.status, 403);
    const again = await TestClient.connect(server.port, lanIp);
    await again.waitFor(W.AUTH.KICKED);
    await again.closed;

    const list = await manager.client.request(W.ADMIN.LIST_BLOCKED, {});
    assert.equal(list.data.blocked[0].reason, 'Thử nghiệm');
    const un = await manager.client.request(W.ADMIN.UNBLOCK_IP, { ip: lanIp });
    assert.deepEqual(un.data, { ip: lanIp });
    const ok = await fetch(server.httpUrl('/health', lanIp));
    assert.equal(ok.status, 200);
  });

  it('ingests client logs with dedup + redaction; readable only via the localhost admin API', async () => {
    const logId = crypto.randomUUID();
    const entry = {
      log_id: logId,
      ts: new Date().toISOString(),
      level: C.LOG_LEVEL.AUDIT,
      category: C.LOG_CATEGORY.AUTH,
      user_id: 9999, // server bỏ qua, dùng user của socket
      client_id: 'pc-01',
      action: 'client_test_action',
      meta: { password: 'secret', nested: { session_token: 'abc' }, note: 'ok' },
    };
    const ack1 = await member.client.request(W.LOG.BATCH, { logs: [entry, { bad: true }] });
    assert.deepEqual(ack1.data.ids, [logId]);
    const ack2 = await member.client.request(W.LOG.EVENT, { log: entry });
    assert.deepEqual(ack2.data.ids, [logId]);

    // Trang admin gọi thẳng logAggregator (route HTTP chỉ mở cho localhost — test riêng trong adminLogPage.test.js)
    const query = (filters) => server.instance.services.logAggregator.query(filters);
    const q = await query({ action: 'client_test_action' });
    assert.equal(q.logs.length, 1, 'dedup theo log_id');
    const row = q.logs[0];
    assert.equal(row.user_id, member.user.id);
    assert.equal(row.username, member.user.username);
    assert.equal(row.display_name, member.user.display_name);
    assert.equal(row.meta.password, '[REDACTED]');
    assert.equal(row.meta.nested.session_token, '[REDACTED]');
    assert.equal(row.meta.note, 'ok');

    const serverLogs = await query({ level: C.LOG_LEVEL.AUDIT, category: C.LOG_CATEGORY.AUTH, action: 'login_success', limit: 5 });
    assert.ok(serverLogs.logs.length >= 1);
    assert.ok(serverLogs.logs.every((l) => l.level === C.LOG_LEVEL.AUDIT && l.action.includes('login_success')));
    const limited = await query({ limit: 2 });
    assert.equal(limited.logs.length, 2);
    assert.ok(limited.logs[0].ts >= limited.logs[1].ts);
  });
});
