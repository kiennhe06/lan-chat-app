'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const W = require('../src/shared/wsEvents');
const C = require('../src/shared/constants');
const { verifySignature } = require('../src/modules/auth/tokenService');
const { bootServer, TestClient, registerUser, userInput } = require('./helpers');

describe('auth', () => {
  let server;
  let manager;

  before(async () => {
    server = await bootServer();
    manager = await registerUser(server.port, 'boss');
  });
  after(async () => {
    await manager.client.close();
    await server.close();
  });

  it('first registered user becomes manager, later users are members and user:created is broadcast', async () => {
    assert.equal(manager.user.role, C.USER_ROLE.MANAGER);
    assert.ok(manager.payload.server_public_key.includes('BEGIN PUBLIC KEY'));
    assert.ok(manager.payload.server_time);
    const second = await registerUser(server.port, 'staff');
    assert.equal(second.user.role, C.USER_ROLE.MEMBER);
    const pushed = await manager.client.waitFor(W.USER.CREATED, (d) => d.user.id === second.user.id);
    assert.equal(pushed.data.user.username, second.user.username);
    await second.client.close();
  });

  it('pushes presence:list right after auth', async () => {
    const u = await registerUser(server.port, 'pres');
    const list = await u.client.waitFor(W.PRESENCE.LIST);
    assert.ok(list.data.online_user_ids.includes(u.user.id));
    await u.client.close();
  });

  it('logs in by username and by employee_id case-insensitively', async () => {
    const u = await registerUser(server.port, 'Login');
    await u.client.close();
    const c1 = await TestClient.connect(server.port);
    const r1 = await c1.request(W.AUTH.LOGIN, { identifier: `  ${u.input.username.toUpperCase()} `, password: u.input.password });
    assert.equal(r1.type, W.AUTH.LOGIN_OK);
    assert.equal(r1.data.user.id, u.user.id);
    assert.equal(r1.data.user.username, u.input.username, 'original case is preserved');
    await c1.close();
    const c2 = await TestClient.connect(server.port);
    const r2 = await c2.request(W.AUTH.LOGIN, { identifier: u.input.employee_id.toLowerCase(), password: u.input.password });
    assert.equal(r2.type, W.AUTH.LOGIN_OK);
    assert.equal(r2.data.user.id, u.user.id);
    await c2.close();
  });

  it('returns exactly the generic Vietnamese message for wrong password and unknown user', async () => {
    const u = await registerUser(server.port, 'wrong');
    await u.client.close();
    const c = await TestClient.connect(server.port);
    const bad = await c.request(W.AUTH.LOGIN, { identifier: u.input.username, password: 'nope-nope' });
    assert.equal(bad.type, W.AUTH.LOGIN_ERR);
    assert.deepEqual(bad.error, { code: C.ERROR_CODE.INVALID_CREDENTIALS, message: C.MESSAGES_VI.INVALID_CREDENTIALS });
    const unknown = await c.request(W.AUTH.LOGIN, { identifier: 'no_such_user', password: 'whatever' });
    assert.deepEqual(unknown.error, { code: C.ERROR_CODE.INVALID_CREDENTIALS, message: C.MESSAGES_VI.INVALID_CREDENTIALS });
    // Mật khẩu không bị trim: thêm khoảng trắng → sai
    const padded = await c.request(W.AUTH.LOGIN, { identifier: u.input.username, password: ` ${u.input.password}` });
    assert.equal(padded.type, W.AUTH.LOGIN_ERR);
    await c.close();
  });

  it('rejects duplicate username (case-insensitive) and invalid input', async () => {
    const u = await registerUser(server.port, 'dup');
    const c = await TestClient.connect(server.port);
    const dup = await c.request(W.AUTH.REGISTER, { ...userInput('x'), username: u.input.username.toUpperCase() });
    assert.equal(dup.type, W.AUTH.REGISTER_ERR);
    assert.equal(dup.error.code, C.ERROR_CODE.DUPLICATE);
    const dupEmp = await c.request(W.AUTH.REGISTER, { ...userInput('y'), employee_id: u.input.employee_id.toLowerCase() });
    assert.equal(dupEmp.error.code, C.ERROR_CODE.DUPLICATE);
    const badPw = await c.request(W.AUTH.REGISTER, { ...userInput('z'), password: 'mậtkhẩu123' });
    assert.equal(badPw.error.code, C.ERROR_CODE.VALIDATION);
    assert.equal(badPw.error.message, C.MESSAGES_VI.PASSWORD_HINT);
    const badName = await c.request(W.AUTH.REGISTER, { ...userInput('w'), username: 'has space' });
    assert.equal(badName.error.code, C.ERROR_CODE.VALIDATION);
    await c.close();
    await u.client.close();
  });

  it('normalizes display_name (NFC + collapse spaces)', async () => {
    const c = await TestClient.connect(server.port);
    const decomposed = 'Nguyễn   Văn'; // dạng NFD
    const r = await c.request(W.AUTH.REGISTER, { ...userInput('nfc'), display_name: `  ${decomposed}  ` });
    assert.equal(r.data.user.display_name, 'Nguyễn Văn'.normalize('NFC'));
    await c.close();
  });

  it('requires auth before other events', async () => {
    const c = await TestClient.connect(server.port);
    const r = await c.request(W.CONV.LIST, {});
    assert.equal(r.error.code, C.ERROR_CODE.UNAUTHORIZED);
    await c.close();
  });

  it('reconnects via session_token, and logout revokes it', async () => {
    const u = await registerUser(server.port, 'recon');
    await u.client.close();
    const c = await TestClient.connect(server.port);
    const r = await c.request(W.AUTH.RECONNECT, { session_token: u.token });
    assert.equal(r.type, W.AUTH.RECONNECT_OK);
    assert.equal(r.data.session_token, u.token, 'token còn hạn dài được giữ nguyên');
    const out = await c.request(W.AUTH.LOGOUT, {});
    assert.equal(out.type, W.AUTH.LOGOUT_OK);
    await c.closed;
    const c2 = await TestClient.connect(server.port);
    const again = await c2.request(W.AUTH.RECONNECT, { session_token: u.token });
    assert.equal(again.type, W.AUTH.RECONNECT_ERR);
    assert.equal(again.error.code, C.ERROR_CODE.UNAUTHORIZED);
    await c2.close();
  });

  it('change password issues a new token and revokes other sessions', async () => {
    const u = await registerUser(server.port, 'chpw');
    const other = await TestClient.connect(server.port);
    await other.request(W.AUTH.LOGIN, { identifier: u.input.username, password: u.input.password });
    const wrong = await u.client.request(W.USER.CHANGE_PASSWORD, { old_password: 'bad-old', new_password: 'newpass123' });
    assert.equal(wrong.error.code, C.ERROR_CODE.VALIDATION);
    const r = await u.client.request(W.USER.CHANGE_PASSWORD, { old_password: u.input.password, new_password: 'newpass123' });
    assert.equal(r.data.ok, true);
    assert.ok(r.data.session_token && r.data.session_token !== u.token);
    await other.waitFor(W.AUTH.KICKED);
    const c = await TestClient.connect(server.port);
    const old = await c.request(W.AUTH.RECONNECT, { session_token: u.token });
    assert.equal(old.type, W.AUTH.RECONNECT_ERR);
    const fresh = await c.request(W.AUTH.RECONNECT, { session_token: r.data.session_token });
    assert.equal(fresh.type, W.AUTH.RECONNECT_OK);
    await c.close();
    await u.client.close();
  });

  it('session token verifies with the server public key; tampering is rejected', async () => {
    const u = await registerUser(server.port, 'tok');
    const payload = verifySignature(u.token, u.payload.server_public_key);
    assert.ok(payload);
    assert.equal(payload.uid, u.user.id);
    assert.equal(payload.un, u.user.username);
    assert.equal(payload.exp - payload.iat, C.SESSION_TTL_MS);
    assert.match(payload.jti, /^[a-f0-9]{32}$/);

    const [body, sig] = u.token.split('.');
    const forged = Buffer.from(JSON.stringify({ ...payload, uid: 1 })).toString('base64url');
    assert.equal(verifySignature(`${forged}.${sig}`, u.payload.server_public_key), null);
    const flipped = sig.slice(0, -2) + (sig.slice(-2) === 'AA' ? 'BB' : 'AA');
    assert.equal(verifySignature(`${body}.${flipped}`, u.payload.server_public_key), null);

    const c = await TestClient.connect(server.port);
    const r = await c.request(W.AUTH.RECONNECT, { session_token: `${forged}.${sig}` });
    assert.equal(r.error.code, C.ERROR_CODE.UNAUTHORIZED);
    await c.close();
    await u.client.close();
  });

  it('updates profile and settings', async () => {
    const u = await registerUser(server.port, 'prof');
    const r = await u.client.request(W.USER.UPDATE_PROFILE, { display_name: '  Tên   Mới ' });
    assert.equal(r.data.user.display_name, 'Tên Mới');
    await manager.client.waitFor(W.USER.UPDATED, (d) => d.user.id === u.user.id);
    const s = await u.client.request(W.USER.UPDATE_SETTINGS, { theme: C.THEME.DARK });
    assert.deepEqual(s.data.settings, { theme: C.THEME.DARK });
    const list = await u.client.request(W.USER.LIST, {});
    const me = list.data.users.find((x) => x.id === u.user.id);
    assert.equal(me.online, true);
    await u.client.close();
    const c = await TestClient.connect(server.port);
    const login = await c.request(W.AUTH.LOGIN, { identifier: u.input.username, password: u.input.password });
    assert.equal(login.data.settings.theme, C.THEME.DARK);
    await c.close();
  });
});
