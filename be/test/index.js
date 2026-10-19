/**
 * Entry cho `node --test test/` (Node coi thư mục là module → nạp test/index.js).
 * Nạp mọi file *.test.js trong thư mục này. `npm test` dùng lệnh trên.
 */
'use strict';

const fs = require('fs');
const path = require('path');

for (const name of fs.readdirSync(__dirname).sort()) {
  if (name.endsWith('.test.js')) require(path.join(__dirname, name));
}
