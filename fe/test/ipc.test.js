'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { IPC_INVOKE } = require('../ipc/channels');
const { buildHandlers } = require('../electron/core/ipc');
const { wrapHandler } = require('../electron/core/ipc/register');
const { AppError } = require('../electron/core/utils/errors');
const { silentLogger } = require('./helpers');

test('every IPC_INVOKE channel has exactly one handler', () => {
  const handlers = buildHandlers({ logger: silentLogger });
  const expected = Object.values(IPC_INVOKE).sort();
  assert.deepStrictEqual(Object.keys(handlers).sort(), expected);
});

test('wrapHandler returns {ok,data} or Vietnamese {ok:false,error}', async () => {
  const ok = await wrapHandler('x', () => 5, silentLogger)({}, null);
  assert.deepStrictEqual(ok, { ok: true, data: 5 });
  const known = await wrapHandler('x', () => { throw new AppError('VALIDATION', 'Sai'); }, silentLogger)({}, null);
  assert.deepStrictEqual(known, { ok: false, error: { code: 'VALIDATION', message: 'Sai' } });
  const unknown = await wrapHandler('x', () => { throw new TypeError('boom'); }, silentLogger)({}, null);
  assert.strictEqual(unknown.error.code, 'INTERNAL');
});
