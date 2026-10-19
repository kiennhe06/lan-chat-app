#!/usr/bin/env node
/**
 * Thay cho electron-rebuild: better-sqlite3 >= 12 dùng N-API + prebuild có sẵn trong package
 * (prebuilds/win32-x64.node) → cùng binary chạy được cho cả Node và Electron, không cần compile.
 * Script này chỉ kiểm tra binary Windows x64 có mặt trước khi đóng gói portable.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REQUIRED_PREBUILDS = [path.join('better-sqlite3', 'prebuilds', 'win32-x64.node')];

const missing = REQUIRED_PREBUILDS.filter((rel) => !fs.existsSync(path.join(__dirname, '..', 'node_modules', rel)));
if (missing.length) {
  console.error(`✖ Thiếu native prebuild: ${missing.join(', ')} — chạy lại "npm ci" trên máy có internet.`);
  process.exit(1);
}
console.log('✔ Native modules (N-API prebuild win32-x64) sẵn sàng — không cần electron-rebuild.');
