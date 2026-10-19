'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const crypto = require('crypto');
const W = require('../src/shared/wsEvents');
const C = require('../src/shared/constants');
const { listIpv4Interfaces } = require('../src/core/utils/network');
const { isLocalRequest } = require('../src/modules/log/adminLogRoutes');
const { bootServer, registerUser } = require('./helpers');

const lanIp = (listIpv4Interfaces()[0] || {}).address;
const SECRET_TEXT = 'noi-dung-bi-mat-khong-duoc-ghi-log';

/** GET thô để tự đặt Host header (fetch không cho đổi Host). */
function rawGet(port, path, hostHeader, connectHost) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: connectHost || '127.0.0.1', port, path, method: 'GET', headers: { Host: hostHeader } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('admin log page (máy chủ only)', () => {
  let server;
  let a;
  let b;
  let direct;

  before(async () => {
    server = await bootServer();
    a = await registerUser(server.port, 'quanly');
    b = await registerUser(server.port, 'nhanvien');
    direct = (await a.client.request(W.CONV.CREATE, { type: C.CONVERSATION_TYPE.DIRECT, member_ids: [b.user.id] })).data.conversation;
    await b.client.request(W.MESSAGE.SEND, {
      client_message_id: crypto.randomUUID(),
      conversation_id: direct.id,
      type: C.MESSAGE_TYPE.TEXT,
      content: SECRET_TEXT,
    });
  });

  after(async () => {
    a.client.close();
    b.client.close();
    await server.close();
  });

  it('isLocalRequest only accepts loopback IP with a localhost Host header', () => {
    assert.equal(isLocalRequest('127.0.0.1', 'localhost:5001'), true);
    assert.equal(isLocalRequest('127.0.0.1', '127.0.0.1:5001'), true);
    assert.equal(isLocalRequest('127.0.0.1', '[::1]:5001'), true);
    assert.equal(isLocalRequest('192.168.1.20', 'localhost:5001'), false);
    assert.equal(isLocalRequest('127.0.0.1', 'evil.example:5001'), false);
    assert.equal(isLocalRequest('127.0.0.1', ''), false);
  });

  it('serves the page on localhost without CORS headers and with a strict CSP', async () => {
    const res = await rawGet(server.port, '/admin', `localhost:${server.port}`);
    assert.equal(res.status, 200);
    assert.match(res.body, /Nhật ký hoạt động/);
    assert.equal(res.headers['access-control-allow-origin'], undefined);
    assert.match(res.headers['content-security-policy'], /default-src 'none'/);
    const script = await rawGet(server.port, '/admin/app.js', `localhost:${server.port}`);
    assert.equal(script.status, 200);
  });

  it('rejects a foreign Host header (DNS rebinding) even from loopback', async () => {
    const res = await rawGet(server.port, '/admin/api/logs', `attacker.example:${server.port}`);
    assert.equal(res.status, 403);
  });

  it('rejects other machines in the LAN', { skip: !lanIp && 'không có interface LAN' }, async () => {
    const res = await rawGet(server.port, '/admin/api/logs', `${lanIp}:${server.port}`, lanIp);
    assert.equal(res.status, 403);
    assert.match(res.body, /chỉ mở được trên chính máy chủ/);
  });

  it('lists member activity with readable labels but never message content', async () => {
    const res = await rawGet(server.port, `/admin/api/logs?users_only=true&user_id=${b.user.id}`, `localhost:${server.port}`);
    assert.equal(res.status, 200);
    const { logs } = JSON.parse(res.body);
    const sent = logs.find((e) => e.action === 'message_sent');
    assert.ok(sent, 'phải có log gửi tin');
    assert.equal(sent.username, b.user.username);
    assert.match(sent.conversation_label, /^Chat 1-1: /);
    assert.equal(sent.meta.type, C.MESSAGE_TYPE.TEXT);
    assert.ok(logs.every((e) => e.user_id === b.user.id));
    assert.ok(!res.body.includes(SECRET_TEXT), 'nội dung tin nhắn không được xuất hiện trong log');
  });

  it('records the client IP even for actions whose service does not receive it (conversation create)', async () => {
    const { logs } = await server.instance.services.logAggregator.query({ action: 'conversation_created' });
    assert.ok(logs.length >= 1);
    assert.equal(logs[0].ip, '127.0.0.1');
  });

  it('keyword search matches member names', async () => {
    const res = await rawGet(server.port, `/admin/api/logs?q=${encodeURIComponent(a.user.username)}`, `localhost:${server.port}`);
    const { logs } = JSON.parse(res.body);
    assert.ok(logs.length > 0);
    assert.ok(logs.every((e) => JSON.stringify(e).toLowerCase().includes(a.user.username.toLowerCase())));
  });

  it('exports filtered logs as JSONL', async () => {
    const res = await rawGet(server.port, '/admin/api/export?category=auth', `localhost:${server.port}`);
    assert.equal(res.status, 200);
    assert.match(res.headers['content-disposition'], /\.jsonl"/);
    const lines = res.body.trim().split('\n').map((line) => JSON.parse(line));
    assert.ok(lines.length > 0);
    assert.ok(lines.every((e) => e.category === C.LOG_CATEGORY.AUTH));
  });

  it('no longer answers log queries over WebSocket (not even for the manager)', async () => {
    assert.equal(a.user.role, C.USER_ROLE.MANAGER);
    const reply = await a.client.request('log:query', {});
    assert.ok(reply.error, 'log:query qua WS phải bị từ chối');
  });
});
