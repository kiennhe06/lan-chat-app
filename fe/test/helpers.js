'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDatabase } = require('../electron/core/db/database');
const { createRepositories } = require('../electron/core/db/repositories');

/** DB in-memory + repositories */
function makeRepos() {
  const { db } = openDatabase(':memory:');
  return createRepositories(db);
}

/** Thư mục tạm cho test, tự xóa bằng cleanup() */
function tmpDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix || 'lanchat-test-'));
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

const silentLogger = { log() {}, debug() {}, info() {}, warn() {}, error() {}, audit() {}, flush() {} };

module.exports = { makeRepos, tmpDir, silentLogger };
