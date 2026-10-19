#!/usr/bin/env node
/**
 * Copy toàn bộ file trong be/src/shared/ → fe/shared/.
 * be/src/shared là BẢN GỐC. Không dùng symlink (lỗi khi build trên Windows).
 * Chạy: npm run sync:shared (ở thư mục gốc hoặc trong client/).
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SOURCE_DIR = path.join(ROOT, 'be', 'src', 'shared');
const TARGET_DIR = path.join(ROOT, 'fe', 'shared');

function syncShared() {
  if (!fs.existsSync(SOURCE_DIR)) {
    throw new Error(`Không tìm thấy thư mục nguồn: ${SOURCE_DIR}`);
  }
  fs.mkdirSync(TARGET_DIR, { recursive: true });
  const files = fs.readdirSync(SOURCE_DIR).filter((name) => name.endsWith('.js'));
  for (const name of files) {
    fs.copyFileSync(path.join(SOURCE_DIR, name), path.join(TARGET_DIR, name));
    console.log(`  ✔ ${name}`);
  }
  console.log(`Đã đồng bộ ${files.length} file shared → fe/shared/`);
}

try {
  syncShared();
} catch (err) {
  console.error(`✖ sync:shared thất bại: ${err.message}`);
  process.exit(1);
}
