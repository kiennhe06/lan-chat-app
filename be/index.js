/**
 * Entry của LAN Chat server: `node index.js` (hoặc start-server.bat / start-server.vbs).
 * Toàn bộ mã nguồn nằm trong src/ — xem README.md mục "Cấu trúc thư mục".
 */
'use strict';

const server = require('./src/core/server');

if (require.main === module) server.runAsMain();

module.exports = server;
