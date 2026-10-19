'use strict';

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { verifySessionToken } = require('../electron/modules/auth/tokenVerifier');
const { ERROR_CODE } = require('../shared/constants');

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function makeToken(privateKey, payload) {
  const p = b64url(JSON.stringify(payload));
  const sig = crypto.sign(null, Buffer.from(p, 'ascii'), privateKey);
  return `${p}.${b64url(sig)}`;
}

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const pem = publicKey.export({ type: 'spki', format: 'pem' });
const now = Date.now();
const claims = { uid: 5, un: 'anh.nv', dn: 'Anh', iat: now, exp: now + 60000, jti: 'abcd' };

test('valid Ed25519 token verifies locally', () => {
  const r = verifySessionToken(makeToken(privateKey, claims), pem, now);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.claims.uid, 5);
});

test('tampered payload is rejected', () => {
  const token = makeToken(privateKey, claims);
  const forged = `${b64url(JSON.stringify({ ...claims, uid: 1 }))}.${token.split('.')[1]}`;
  assert.strictEqual(verifySessionToken(forged, pem, now).ok, false);
});

test('token signed by another key is rejected', () => {
  const other = crypto.generateKeyPairSync('ed25519').privateKey;
  assert.strictEqual(verifySessionToken(makeToken(other, claims), pem, now).ok, false);
});

test('expired token → SESSION_EXPIRED', () => {
  const r = verifySessionToken(makeToken(privateKey, { ...claims, exp: now - 1 }), pem, now);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, ERROR_CODE.SESSION_EXPIRED);
});
