'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const http = require('http');
const sharp = require('sharp');
const W = require('../src/shared/wsEvents');
const C = require('../src/shared/constants');
const { bootServer, registerUser } = require('./helpers');

const SMALL_LIMIT = 64 * 1024;

/** Request thô (để test URL chứa ../ mà fetch sẽ chuẩn hóa mất). */
function rawGet(port, rawPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: rawPath, method: 'GET' }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('http', () => {
  let server;
  let a;
  let b;
  let png;

  const upload = (body, name, headers) =>
    fetch(server.httpUrl('/upload'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${a.token}`, 'Content-Type': 'image/png', 'X-File-Name': encodeURIComponent(name), ...(headers || {}) },
      body,
    });

  before(async () => {
    server = await bootServer({ upload: { maxFileSize: SMALL_LIMIT, maxAvatarSize: C.MAX_AVATAR_SIZE } });
    a = await registerUser(server.port, 'ha');
    b = await registerUser(server.port, 'hb');
    png = await sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 200, g: 50, b: 50 } } }).png().toBuffer();
  });
  after(async () => {
    await a.client.close();
    await b.client.close();
    await server.close();
  });

  it('GET /health', async () => {
    const res = await fetch(server.httpUrl('/health'));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.app, C.APP_NAME);
    assert.equal(body.version, C.APP_VERSION);
    assert.ok(body.server_time);
  });

  it('upload requires a valid bearer token', async () => {
    const res = await fetch(server.httpUrl('/upload'), { method: 'POST', body: 'x' });
    assert.equal(res.status, 401);
    const res2 = await fetch(server.httpUrl('/upload'), { method: 'POST', body: 'x', headers: { Authorization: 'Bearer garbage.token' } });
    assert.equal(res2.status, 401);
  });

  it('uploads an image with thumbnail + dimensions, dedups by sha256, and downloads it', async () => {
    const res = await upload(png, 'ảnh đẹp.png');
    assert.equal(res.status, 200);
    const { file } = await res.json();
    assert.equal(file.sha256, crypto.createHash('sha256').update(png).digest('hex'));
    assert.equal(file.name, 'ảnh đẹp.png');
    assert.equal(file.size, png.length);
    assert.equal(file.mime_type, 'image/png');
    assert.equal(file.has_thumb, true);
    assert.equal(file.width, 800);
    assert.equal(file.height, 600);

    const again = await (await upload(png, 'ảnh đẹp.png')).json();
    assert.equal(again.file.id, file.id, 'cùng hash + cùng tên → cùng row');
    const renamed = await (await upload(png, 'khác.png')).json();
    assert.equal(renamed.file.sha256, file.sha256);
    assert.notEqual(renamed.file.id, file.id);

    const dl = await fetch(server.httpUrl(`/download/${file.id}`), { headers: { Authorization: `Bearer ${b.token}` } });
    assert.equal(dl.status, 200);
    assert.equal(dl.headers.get('content-length'), String(png.length));
    assert.match(dl.headers.get('content-disposition'), /filename\*=UTF-8''%E1%BA%A3nh/);
    assert.ok(Buffer.from(await dl.arrayBuffer()).equals(png));

    const byHash = await fetch(server.httpUrl(`/file/by-hash/${file.sha256}?token=${encodeURIComponent(b.token)}`));
    assert.equal(byHash.status, 200);
    assert.ok(Buffer.from(await byHash.arrayBuffer()).equals(png));
    const head = await fetch(server.httpUrl(`/file/by-hash/${file.sha256}`), { method: 'HEAD', headers: { Authorization: `Bearer ${b.token}` } });
    assert.equal(head.status, 200);
    const missingHead = await fetch(server.httpUrl(`/file/by-hash/${'0'.repeat(64)}`), { method: 'HEAD', headers: { Authorization: `Bearer ${b.token}` } });
    assert.equal(missingHead.status, 404);
    const noAuth = await fetch(server.httpUrl(`/download/${file.id}`));
    assert.equal(noAuth.status, 401);

    const thumb = await fetch(server.httpUrl(`/thumb/${file.sha256}`));
    assert.equal(thumb.status, 200);
    assert.equal(thumb.headers.get('content-type'), 'image/webp');
    const meta = await sharp(Buffer.from(await thumb.arrayBuffer())).metadata();
    assert.ok(Math.max(meta.width, meta.height) <= C.THUMB_MAX_PX);

    // file-batch giờ thấy file
    const fb = await a.client.request(W.SYNC.FILE_BATCH, { files: [{ sha256: file.sha256, name: 'ảnh đẹp.png' }] });
    assert.deepEqual(fb.data.missing, []);
    assert.equal(fb.data.existing[0].file.id, file.id);

    // Gửi tin ảnh bằng file_id
    const direct = (await a.client.request(W.CONV.CREATE, { type: C.CONVERSATION_TYPE.DIRECT, member_ids: [b.user.id] })).data.conversation;
    const sent = await a.client.request(W.MESSAGE.SEND, { client_message_id: crypto.randomUUID(), conversation_id: direct.id, type: C.MESSAGE_TYPE.IMAGE, content: '', file_id: file.id });
    assert.equal(sent.data.message.file.sha256, file.sha256);
  });

  it('sanitizes file names and rejects traversal / malformed paths', async () => {
    const res = await upload(Buffer.from('hello'), '../../etc/passwd', { 'Content-Type': 'text/plain' });
    const { file } = await res.json();
    assert.equal(file.name, 'passwd');
    assert.equal(file.mime_type, 'text/plain');
    assert.equal(await rawGet(server.port, '/thumb/../../app-config.json'), 404);
    assert.equal(await rawGet(server.port, '/avatar/..%2F..%2Fapp-config.json'), 404);
    assert.equal(await rawGet(server.port, '/download/abc'), 404);
    assert.equal(await rawGet(server.port, `/thumb/${'z'.repeat(64)}`), 404);
  });

  it('rejects uploads over the limit with 413', async () => {
    const big = Buffer.alloc(SMALL_LIMIT + 1, 1);
    const res = await upload(big, 'big.bin', { 'Content-Type': 'application/octet-stream' });
    assert.equal(res.status, 413);
    const body = await res.json();
    assert.equal(body.error.code, C.ERROR_CODE.TOO_LARGE);
  });

  it('uploads avatar (256x256 webp) and broadcasts user:updated', async () => {
    const res = await fetch(server.httpUrl('/avatar'), { method: 'POST', headers: { Authorization: `Bearer ${a.token}`, 'Content-Type': 'image/png' }, body: png });
    assert.equal(res.status, 200);
    const { user } = await res.json();
    assert.match(user.avatar, /^u\d+-[a-f0-9]+\.webp$/);
    await b.client.waitFor(W.USER.UPDATED, (x) => x.user.id === a.user.id && x.user.avatar === user.avatar);
    const img = await fetch(server.httpUrl(`/avatar/${user.avatar}`));
    assert.equal(img.status, 200);
    const meta = await sharp(Buffer.from(await img.arrayBuffer())).metadata();
    assert.equal(meta.width, C.AVATAR_SIZE_PX);
    assert.equal(meta.height, C.AVATAR_SIZE_PX);
    const notImage = await fetch(server.httpUrl('/avatar'), { method: 'POST', headers: { Authorization: `Bearer ${a.token}` }, body: 'not an image' });
    assert.equal(notImage.status, 400);
  });
});
