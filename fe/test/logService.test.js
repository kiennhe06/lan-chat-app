'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { redact, logFileName, createLogService, REDACTED } = require('../electron/modules/log/logService');
const { tmpDir } = require('./helpers');

test('redact hides password/token/secret/authorization and drops content by default', () => {
  const out = redact({ password: 'x', session_token: 'y', nested: { Authorization: 'z', ok: 1 }, content: 'hello' });
  assert.strictEqual(out.password, REDACTED);
  assert.strictEqual(out.session_token, REDACTED);
  assert.strictEqual(out.nested.Authorization, REDACTED);
  assert.strictEqual(out.nested.ok, 1);
  assert.strictEqual(out.content, undefined);
  assert.strictEqual(redact({ content: 'a'.repeat(300) }, { logMessageContent: true }).content_preview.length, 100);
});

test('rotation naming: YYYY-MM-DD.jsonl then -1, -2 when size cap is reached', () => {
  assert.strictEqual(logFileName('2026-10-18', 0), '2026-10-18.jsonl');
  assert.strictEqual(logFileName('2026-10-18', 2), '2026-10-18-2.jsonl');
  const t = tmpDir();
  try {
    const fixed = new Date('2026-10-18T10:00:00');
    const log = createLogService({ dir: t.dir, clientId: 'c', maxFileBytes: 400, shipEnabled: false, now: () => fixed });
    for (let i = 0; i < 10; i += 1) log.info('app', `action_${i}`, { i });
    const files = fs.readdirSync(t.dir).sort();
    assert.ok(files.includes('2026-10-18.jsonl'));
    assert.ok(files.includes('2026-10-18-1.jsonl'));
    for (const f of files) assert.ok(fs.statSync(path.join(t.dir, f)).size <= 400);
    const lineCount = files.reduce((sum, f) => sum + fs.readFileSync(path.join(t.dir, f), 'utf8').split('\n').filter(Boolean).length, 0);
    assert.strictEqual(lineCount, 10);
  } finally {
    t.cleanup();
  }
});

test('cleanupOld removes files past retention', () => {
  const t = tmpDir();
  try {
    fs.writeFileSync(path.join(t.dir, '2020-01-01.jsonl'), '');
    fs.writeFileSync(path.join(t.dir, '2026-10-17.jsonl'), '');
    const log = createLogService({ dir: t.dir, clientId: 'c', retentionDays: 30, now: () => new Date('2026-10-18T00:00:00') });
    assert.strictEqual(log.cleanupOld(), 1);
    assert.deepStrictEqual(fs.readdirSync(t.dir), ['2026-10-17.jsonl']);
  } finally {
    t.cleanup();
  }
});
