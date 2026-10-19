'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { openDatabase, closeDatabase, getSchemaVersion, LATEST_VERSION } = require('../electron/core/db/database');
const { tmpDir } = require('./helpers');

test('migrations create all spec tables and record schema_version', () => {
  const { db, applied } = openDatabase(':memory:');
  assert.deepStrictEqual(applied, [1, 2, 3]);
  assert.strictEqual(getSchemaVersion(db), LATEST_VERSION);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
  for (const t of ['messages', 'conversations_cache', 'users_cache', 'settings', 'peers_cache', 'vector_clock', 'action_queue', 'p2p_files', 'downloads']) {
    assert.ok(tables.includes(t), `missing table ${t}`);
  }
  const msgCols = db.prepare('PRAGMA table_info(messages)').all().map((c) => c.name);
  for (const c of ['vector_clock', 'p2p_receipts', 'created_at_local', 'sort_key', 'client_message_id', 'server_id']) assert.ok(msgCols.includes(c));
  closeDatabase(db);
});

test('re-opening an existing DB applies no migration twice and uses WAL', () => {
  const t = tmpDir();
  try {
    const file = path.join(t.dir, 'client.db');
    const first = openDatabase(file);
    assert.strictEqual(first.db.pragma('journal_mode', { simple: true }), 'wal');
    closeDatabase(first.db);
    const second = openDatabase(file);
    assert.deepStrictEqual(second.applied, []);
    closeDatabase(second.db);
  } finally {
    t.cleanup();
  }
});
