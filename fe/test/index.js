/**
 * Entry cho `node --test test/` (Node 22+ coi đối số thư mục là đường dẫn module → nạp index.js).
 * Nạp mọi file *.test.js trong thư mục này. `node --test` (không đối số) cũng tự tìm *.test.js.
 */
'use strict';

const fs = require('fs');
const path = require('path');

for (const name of fs.readdirSync(__dirname).sort()) {
  if (name.endsWith('.test.js')) require(path.join(__dirname, name));
}
